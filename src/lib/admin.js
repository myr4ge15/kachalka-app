// ============================================================================
// Клиентский слой админки (PLAN-admin). Все операции — НАД ЧУЖИМИ строками,
// поэтому идут привилегированным путём с серверным гейтом role='admin':
//   - непарольные (список/правка/слияние упражнений, имя/роль) — SECURITY
//     DEFINER-RPC (is_admin() внутри); клиентскому role верим только для показа
//     пункта меню, не для доступа;
//   - сброс PIN и создание учётки — service-role Edge Functions с реальным
//     access_token админа в Bearer (серверу нужен claim app_user_id).
//
// Сеть отделена от Dexie (repo.js): после успешной правки упражнения зеркалим
// изменение в локальный кэш через repo-хелперы, чтобы UI обновился до pull.
// ============================================================================
import { supabase } from '../db/supabase.js'
import { db } from '../db/local.js'
import { applyExerciseEditLocal, applyExerciseMergeLocal } from '../db/repo.js'
import { DB_TIMEOUT_MS, withTimeout } from './withTimeout.js'
import { defaultSubmuscleFor, cleanSecondary } from './muscles.js'

const RESET_PIN_URL = (import.meta.env.VITE_SUPABASE_URL ?? '') + '/functions/v1/admin-reset-pin'
const CREATE_USER_URL = (import.meta.env.VITE_SUPABASE_URL ?? '') + '/functions/v1/admin-create-user'
const ANON = import.meta.env.VITE_SUPABASE_KEY ?? ''

// Ошибка админ-операции с человекочитаемым сообщением для тоста.
export class AdminError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AdminError'
  }
}

// fetch с жёстким таймаутом (как в lib/auth.js): подвисшая сеть не вешает UI.
async function fetchWithTimeout(url, opts, ms = DB_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

// Реальный access_token текущей сессии (мост уже положил его через setSession).
async function accessToken() {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token ?? null
  } catch {
    return null
  }
}

// ----------------------------- Пользователи --------------------------------

// Список пользователей для админки (id, name, role, created_at). RPC с гейтом.
export async function adminListUsers() {
  const res = await withTimeout(supabase.rpc('admin_list_users'))
  if (res.error) throw new AdminError(res.error.message ?? 'Не удалось получить список.')
  return (res.data ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    is_private: Boolean(u.is_private),
    sex: u.sex ?? null,
    sort_order: u.sort_order ?? null,
    created_at: u.created_at,
  }))
}

// Задать порядок учёток на экране входа (drag-and-drop в админке). ids — полный
// список id в нужном порядке; позиция в массиве = sort_order. RPC с is_admin().
export async function adminSetUserOrder(ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw new AdminError('Пустой список.')
  const res = await withTimeout(supabase.rpc('admin_set_user_order', { p_ids: ids }))
  if (res.error) throw new AdminError(humanRpc(res.error.message))
  return true
}

// Включить/выключить приватный режим участника: его результаты (лента,
// лидерборд, цели) видит только он сам и админ, а сам он видит только свои.
// RPC с серверным гейтом is_admin().
export async function adminSetPrivate(id, isPrivate) {
  const res = await withTimeout(
    supabase.rpc('admin_set_private', { p_id: id, p_private: Boolean(isPrivate) })
  )
  if (res.error) throw new AdminError(humanRpc(res.error.message))
  return { id, is_private: Boolean(isPrivate) }
}

// Задать пол участника ('m' | 'f' | null) — для раздельного лидерборда М/Ж.
// null/'' = «не задан» (участник попадает в мужской борд). RPC с is_admin().
export async function adminSetSex(id, sex) {
  const v = sex === 'm' || sex === 'f' ? sex : null
  const res = await withTimeout(
    supabase.rpc('admin_set_sex', { p_id: id, p_sex: v })
  )
  if (res.error) throw new AdminError(humanRpc(res.error.message))
  return { id, sex: v }
}

// Сменить имя/роль участника. Сервер бережёт последнего админа от разжалования.
export async function adminSetUser(id, name, role) {
  const clean = String(name ?? '').trim()
  if (clean.length < 1 || clean.length > 40) throw new AdminError('Имя — от 1 до 40 символов.')
  if (role !== 'admin' && role !== 'member') throw new AdminError('Недопустимая роль.')
  const res = await withTimeout(
    supabase.rpc('admin_set_user', { p_id: id, p_name: clean, p_role: role })
  )
  if (res.error) throw new AdminError(humanRpc(res.error.message))
  return { id, name: clean, role }
}

// Сбросить PIN участнику (Edge Function). new_pin опционален — сервер сгенерит.
// Возвращает установленный PIN (для передачи человеку).
export async function adminResetPin(targetUserId, newPin = '') {
  if (newPin && !/^\d{4}$/.test(newPin)) throw new AdminError('PIN — 4 цифры.')
  const token = await accessToken()
  if (!token) throw new AdminError('Сессия не найдена — войди заново.')
  const body = { target_user_id: targetUserId }
  if (newPin) body.new_pin = newPin

  let res
  try {
    res = await fetchWithTimeout(RESET_PIN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON, authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AdminError('Нет сети — попробуй позже.')
  }
  let payload = null
  try { payload = await res.json() } catch { /* нестандартное тело */ }
  if (res.status === 403) throw new AdminError('Нужны права админа.')
  if (res.status === 401) throw new AdminError('Сессия истекла — войди заново.')
  if (res.status === 404) throw new AdminError('Участник не найден.')
  if (!res.ok || !payload?.ok || !payload?.pin) {
    throw new AdminError(payload?.error ?? 'Не удалось сбросить PIN.')
  }
  return payload.pin
}

// Создать нового участника (Edge Function). Возвращает { id, name, role }.
export async function adminCreateUser(name, role, pin) {
  const clean = String(name ?? '').trim()
  if (clean.length < 1 || clean.length > 40) throw new AdminError('Имя — от 1 до 40 символов.')
  if (role !== 'admin' && role !== 'member') throw new AdminError('Недопустимая роль.')
  if (!/^\d{4}$/.test(pin)) throw new AdminError('PIN — 4 цифры.')
  const token = await accessToken()
  if (!token) throw new AdminError('Сессия не найдена — войди заново.')

  let res
  try {
    res = await fetchWithTimeout(CREATE_USER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON, authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: clean, role, pin }),
    })
  } catch {
    throw new AdminError('Нет сети — попробуй позже.')
  }
  let payload = null
  try { payload = await res.json() } catch { /* нестандартное тело */ }
  if (res.status === 403) throw new AdminError('Нужны права админа.')
  if (res.status === 401) throw new AdminError('Сессия истекла — войди заново.')
  if (res.status === 409) throw new AdminError('Имя уже занято.')
  if (!res.ok || !payload?.ok || !payload?.user) {
    throw new AdminError(payload?.error ?? 'Не удалось создать участника.')
  }
  return payload.user
}

// ----------------------------- Связи (доступ) ------------------------------

// Все связи «избранного круга» (пары low_id/high_id). RPC с гейтом is_admin().
export async function adminListConnections() {
  const res = await withTimeout(supabase.rpc('admin_list_connections'))
  if (res.error) throw new AdminError(humanRpc(res.error.message))
  return (res.data ?? []).map((c) => ({
    low_id: c.low_id,
    high_id: c.high_id,
    status: c.status ?? 'accepted',
  }))
}

// Открыть (connected=true) или снять (false) взаимный доступ между двумя
// участниками. Связь симметрична: оба начинают видеть тренировки друг друга.
export async function adminSetConnection(a, b, connected) {
  if (!a || !b || a === b) throw new AdminError('Нужны два разных участника.')
  const res = await withTimeout(
    supabase.rpc('admin_set_connection', { p_a: a, p_b: b, p_connected: Boolean(connected) })
  )
  if (res.error) throw new AdminError(humanRpc(res.error.message))
  return { a, b, connected: Boolean(connected) }
}

// ----------------------------- Упражнения ----------------------------------

// Правка карточки упражнения + soft-hide. После успеха зеркалим в локальный
// кэш (мгновенный UI). Жим и женское упражнение — каждое единственное: при
// установке флага локально снимаем его с остальных (сервер делает то же).
export async function adminUpdateExercise({ id, name, muscle_group, submuscle, secondary, is_bench_lift, is_female_lift, is_hidden }) {
  const clean = String(name ?? '').trim()
  if (clean.length < 1 || clean.length > 60) throw new AdminError('Название — от 1 до 60 символов.')
  const bench = Boolean(is_bench_lift)
  const female = Boolean(is_female_lift)
  const group = muscle_group ? String(muscle_group).trim() : null
  // Двухуровневая модель мышц (PLAN-muscle-detail, слайс 2): подмышца (primary) +
  // вторичные. Пустая подмышца → дефолт по группе; вторичные санитайзятся.
  const sub = submuscle ? String(submuscle).trim() : defaultSubmuscleFor(group)
  const sec = cleanSecondary(secondary, sub)
  const res = await withTimeout(
    supabase.rpc('admin_update_exercise', {
      p_id: id,
      p_name: clean,
      p_muscle_group: group,
      p_is_bench_lift: bench,
      p_is_female_lift: female,
      p_hidden: Boolean(is_hidden),
      p_submuscle: sub,
      p_secondary: sec,
    })
  )
  if (res.error) throw new AdminError(humanRpc(res.error.message))

  if (bench) {
    // снять прежний флаг жима с других упражнений в локальном кэше
    const others = await db.exercises.filter((e) => e.is_bench_lift && e.id !== id).toArray()
    for (const o of others) await applyExerciseEditLocal(o.id, { is_bench_lift: false })
  }
  if (female) {
    // снять прежний флаг женского упражнения с других в локальном кэше
    const others = await db.exercises.filter((e) => e.is_female_lift && e.id !== id).toArray()
    for (const o of others) await applyExerciseEditLocal(o.id, { is_female_lift: false })
  }
  await applyExerciseEditLocal(id, {
    name: clean,
    muscle_group: group,
    submuscle: sub,
    secondary: sec,
    is_bench_lift: bench,
    is_female_lift: female,
    is_hidden: Boolean(is_hidden),
  })
  return { id, name: clean, muscle_group: group, submuscle: sub, secondary: sec, is_bench_lift: bench, is_female_lift: female, is_hidden: Boolean(is_hidden) }
}

// Слить дубль: from → into. После успеха локально прячем старое (снимки в
// тренировках чинятся на следующем pull).
export async function adminMergeExercise(fromId, intoId) {
  if (!fromId || !intoId) throw new AdminError('Выбери оба упражнения.')
  if (fromId === intoId) throw new AdminError('Нельзя слить упражнение само с собой.')
  const res = await withTimeout(
    supabase.rpc('admin_merge_exercise', { p_from: fromId, p_into: intoId })
  )
  if (res.error) throw new AdminError(humanRpc(res.error.message))
  await applyExerciseMergeLocal(fromId)
  return true
}

// Сообщения серверных raise → человеку. Технические коды не показываем дословно.
function humanRpc(message) {
  const m = String(message ?? '')
  if (m.includes('admin only') || m.includes('42501')) return 'Нужны права админа.'
  if (m.includes('last admin')) return 'Нельзя снять роль с последнего админа.'
  if (m.includes('not found')) return 'Запись не найдена.'
  if (m.includes('1..60')) return 'Название — от 1 до 60 символов.'
  if (m.includes('1..40')) return 'Имя — от 1 до 40 символов.'
  if (m.includes('function') || m.includes('schema')) return 'Сервер не готов: обнови серверную часть.'
  return m || 'Не удалось выполнить операцию.'
}
