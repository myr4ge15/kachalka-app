// ============================================================================
// Логин-мост к Supabase Auth (PLAN-auth §1, §5).
//
// Вход больше НЕ проверяет PIN на клиенте против публичной БД. Вместо этого:
//   - онлайн: шлём { user_id, pin } в Edge Function auth-login по TLS. Она
//     сверяет PIN service-ролью, мостит к скрытой учётке Supabase Auth и
//     возвращает настоящую сессию (access+refresh) + наши pin_hash/pin_salt.
//     setSession сохраняет сессию (supabase-js сам обновляет токен);
//     pin_hash/salt кэшируем локально для офлайн-разблокировки.
//   - офлайн: сверяем PIN с локально закэшированным хэшем (verifyPinOffline) —
//     UI открывается мгновенно без сети, как только устройство хоть раз входило.
//
// pin_hash/pin_salt лежат ТОЛЬКО в своей IndexedDB (meta), не в публичной БД и
// не у других клиентов. PIN текущей сессии держим в памяти (не на диске) как
// запасной путь молчаливого перевыпуска сессии.
// ============================================================================
import { supabase } from '../db/supabase.js'
import { getMeta, setMeta } from '../db/local.js'
import { verifyPin } from './hash.js'
import { DB_TIMEOUT_MS, withTimeout } from './withTimeout.js'

// fetch с жёстким таймаутом через AbortController: подвисшая сеть (корпоративный
// прокси/фаервол «держит» соединение, не отклоняя его) иначе вешала вход на
// минуту+. По истечении DB_TIMEOUT_MS запрос прерывается → fetch бросает →
// вызов мапит это в LoginError('network'), а не крутит спиннер бесконечно.
async function fetchWithTimeout(url, opts, ms = DB_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

const FN_URL = (import.meta.env.VITE_SUPABASE_URL ?? '') + '/functions/v1/auth-login'
const SET_PIN_URL = (import.meta.env.VITE_SUPABASE_URL ?? '') + '/functions/v1/auth-set-pin'
const ANON = import.meta.env.VITE_SUPABASE_KEY ?? ''

// Ключ локального кэша офлайн-разблокировки (свои хэш+соль+имя+роль).
const pinCacheKey = (userId) => `pin_${userId}`

// PIN текущей сессии в памяти (чистится при logout). Не на диске.
let sessionPin = null

// Ошибка входа с машиночитаемым кодом для UI.
export class LoginError extends Error {
  constructor(code, message, retryAfter = null) {
    super(message)
    this.name = 'LoginError'
    this.code = code // 'network' | 'locked' | 'invalid' | 'server'
    this.retryAfter = retryAfter
  }
}

// Онлайн-вход через auth-login. Возвращает { id, name, role }.
export async function login(userId, pin) {
  let res
  try {
    res = await fetchWithTimeout(FN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: ANON,
        authorization: `Bearer ${ANON}`,
      },
      body: JSON.stringify({ user_id: userId, pin }),
    })
  } catch {
    throw new LoginError('network', 'Нет сети — попробуй позже.')
  }

  let body = null
  try { body = await res.json() } catch { /* пустое/нестандартное тело */ }

  if (res.status === 429) {
    throw new LoginError('locked', 'Слишком много попыток. Подожди немного.', body?.retry_after ?? null)
  }
  if (res.status === 401) {
    throw new LoginError('invalid', 'Неверный PIN')
  }
  if (!res.ok || !body?.session) {
    throw new LoginError('server', body?.error ?? 'Не удалось войти.')
  }

  const { error } = await supabase.auth.setSession({
    access_token: body.session.access_token,
    refresh_token: body.session.refresh_token,
  })
  if (error) throw new LoginError('server', error.message)

  // Кэш офлайн-разблокировки — только свои значения текущего пользователя.
  await setMeta(pinCacheKey(userId), {
    pin_hash: body.pin_hash,
    pin_salt: body.pin_salt ?? null,
    name: body.user.name,
    role: body.user.role,
  })
  sessionPin = pin
  return { id: body.user.id, name: body.user.name, role: body.user.role }
}

// Офлайн-проверка PIN по локальному кэшу. Возвращает:
//   { id, name, role } — кэш есть и PIN верный (можно открыть UI);
//   false              — кэш есть, но PIN неверный;
//   null               — кэша нет (первый вход на устройстве → нужна сеть).
export async function verifyPinOffline(userId, pin) {
  const cached = await getMeta(pinCacheKey(userId))
  if (!cached?.pin_hash) return null
  const ok = await verifyPin(pin, { pin_hash: cached.pin_hash, pin_salt: cached.pin_salt })
  if (!ok) return false
  sessionPin = pin
  return { id: userId, name: cached.name, role: cached.role }
}

// Смена своего PIN (PLAN-cabinet-2c §1). Требует ОНЛАЙН и валидную сессию:
// шлём { user_id, current_pin, new_pin } в Edge Function auth-set-pin с Bearer
// текущего access_token (а не anon — серверу нужен claim app_user_id для
// проверки владельца). На успех обновляем офлайн-кэш своими новыми хэш/солью,
// чтобы офлайн-разблокировка сразу принимала новый PIN. Ошибки — LoginError.
export async function setPin(userId, currentPin, newPin) {
  // Реальный токен сессии (логин-мост уже положил его через setSession).
  let accessToken = null
  try {
    const { data } = await supabase.auth.getSession()
    accessToken = data?.session?.access_token ?? null
  } catch { /* ниже обработаем как отсутствие сессии */ }
  if (!accessToken) {
    throw new LoginError('server', 'Сессия не найдена — войди заново.')
  }

  let res
  try {
    res = await fetchWithTimeout(SET_PIN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: ANON,
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ user_id: userId, current_pin: currentPin, new_pin: newPin }),
    })
  } catch {
    throw new LoginError('network', 'Нет сети — попробуй позже.')
  }

  let body = null
  try { body = await res.json() } catch { /* пустое/нестандартное тело */ }

  if (res.status === 429) {
    throw new LoginError('locked', 'Слишком много попыток. Подожди немного.', body?.retry_after ?? null)
  }
  if (res.status === 401) {
    // no_session/invalid_session — сессия протухла; invalid_credentials — неверный текущий PIN.
    const code = body?.error === 'invalid_credentials' ? 'invalid' : 'server'
    const msg = code === 'invalid' ? 'Неверный текущий PIN' : 'Сессия истекла — войди заново.'
    throw new LoginError(code, msg)
  }
  if (res.status === 403) {
    throw new LoginError('server', 'Нельзя сменить чужой PIN.')
  }
  if (!res.ok || !body?.ok) {
    throw new LoginError('server', body?.error ?? 'Не удалось сменить PIN.')
  }

  // Обновляем офлайн-кэш своими новыми значениями (имя/роль сохраняем).
  const cached = (await getMeta(pinCacheKey(userId))) ?? {}
  await setMeta(pinCacheKey(userId), {
    ...cached,
    pin_hash: body.pin_hash,
    pin_salt: body.pin_salt ?? null,
  })
  sessionPin = newPin
  return true
}

// Смена своего имени (PLAN-cabinet-2c). Требует ОНЛАЙН и валидную сессию: пишем
// users.name через SECURITY DEFINER set_my_name (скоуп app_uid() из JWT —
// клиентского UPDATE на users нет). На успех обновляем имя в офлайн-кэше
// (meta pin_${id}), чтобы экран входа офлайн показывал новое имя. Возвращает
// очищенное имя; ошибки — LoginError ('network' | 'invalid' | 'server').
export async function setName(userId, name) {
  const clean = String(name ?? '').trim()
  if (clean.length < 1 || clean.length > 40) {
    throw new LoginError('invalid', 'Имя — от 1 до 40 символов.')
  }
  if (!navigator.onLine) {
    throw new LoginError('network', 'Смена имени — только онлайн.')
  }
  let res
  try {
    res = await withTimeout(supabase.rpc('set_my_name', { p_name: clean }))
  } catch (e) {
    throw new LoginError('network', 'Нет сети — попробуй позже.')
  }
  if (res.error) {
    // 42501 — нет сессии/не владелец; иначе общий серверный отказ (вкл. «RPC
    // ещё не задеплоен»: set_my_name не существует → message с 'function'/'schema').
    throw new LoginError('server', res.error.message ?? 'Не удалось сменить имя.')
  }
  // Обновляем имя в офлайн-кэше своего профиля (хэш/соль/роль сохраняем).
  const cached = (await getMeta(pinCacheKey(userId))) ?? {}
  await setMeta(pinCacheKey(userId), { ...cached, name: clean })
  return clean
}

// Молчаливый перевыпуск сессии (сеть появилась, UI уже открыт офлайн).
// Использует PIN из памяти; если его нет — тихо ничего не делает.
export async function refreshSessionSilently(userId) {
  if (!sessionPin) return false
  try {
    await login(userId, sessionPin)
    return true
  } catch {
    return false
  }
}

export function getSessionPin() {
  return sessionPin
}

export async function logout() {
  sessionPin = null
  try { await supabase.auth.signOut() } catch { /* офлайн — локальная сессия и так уйдёт */ }
}
