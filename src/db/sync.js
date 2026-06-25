// ============================================================================
// Движок синхронизации между локальной базой (Dexie) и Supabase.
//
//   pull  — тянем свежие данные с сервера в Dexie, НЕ затирая локальные
//           несинхронизированные изменения (dirty / tombstone);
//   push  — отправляем очередь `outbox` на сервер через RPC upsert_workout
//           (создание/правка) и delete (удаление). Очередь идёт по порядку;
//           на ошибке останавливаемся и пробуем позже (сеть/сервер недоступны).
//
// Триггеры: вход, событие `online`, возврат вкладки на экран, таймер.
// Конфликты разрешаются по времени (last-write-wins): пока у записи есть
// локальные правки — она в очереди и сервером не перетирается; как только
// отправлена, источником правды снова становится сервер.
// ============================================================================
import { useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase, isConfigured } from './supabase.js'
import { withTimeout } from '../lib/withTimeout.js'
import { db, nowIso, setMeta, getMeta } from './local.js'
import { pendingCount } from './repo.js'
import { fetchFeed } from './feed.js'
import { goalKey } from './notifications.js'
import { onOnline, onOffline, onResume } from '../lib/appEvents.js'
import { cmpIsoAsc } from '../lib/cmp.js'

const POLL_MS = 20000
// После стольких неудачных попыток операция считается «отравленной» и
// откладывается в dead-letter (флаг _dead): она больше не блокирует очередь,
// но остаётся в базе для диагностики. Иначе один битый upsert вешал синк навсегда.
const MAX_ATTEMPTS = 5
// Сколько последних тренировок тянем за один pull. Раньше тянули всю историю
// каждые 20 c. Удаления реконсилируем только в пределах подтянутого окна,
// чтобы не удалить локально записи, которые старше окна и просто не пришли.
const PULL_LIMIT = 200
const SELECT_WORKOUT =
  'id, performed_at, created_at, user_id, ' +
  'workout_exercises(id, position, exercise_id, ' +
  'exercise:exercises(id, name, muscle_group, is_bench_lift), ' +
  'sets(id, set_number, weight, reps))'
const SELECT_TEMPLATE =
  'id, name, user_id, created_at, ' +
  'template_exercises(position, exercise_id, ' +
  'exercise:exercises(id, name, muscle_group, is_bench_lift))'

// ----------------------- наблюдаемое состояние синка -----------------------
let state = { online: navigator.onLine, syncing: false, lastError: null, lastSyncAt: null }
const listeners = new Set()
function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
function subscribe(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getSnapshot = () => state

// ------------------------------- pull --------------------------------------

// server row → локальный денормализованный документ
function rowToDoc(w) {
  const entries = [...(w.workout_exercises ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((we) => ({
      exercise_id: we.exercise_id,
      exercise: we.exercise
        ? {
            id: we.exercise.id,
            name: we.exercise.name,
            muscle_group: we.exercise.muscle_group ?? null,
            is_bench_lift: Boolean(we.exercise.is_bench_lift),
          }
        : { id: we.exercise_id, name: '—' },
      sets: [...(we.sets ?? [])]
        .sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
        .map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) })),
    }))
  return {
    id: w.id,
    user_id: w.user_id,
    performed_at: w.performed_at,
    // created_at с сервера (для сортировки хаба). Фолбэк на performed_at,
    // если сервер ещё не отдаёт это поле.
    created_at: w.created_at ?? w.performed_at,
    updated_at: w.performed_at,
    entries,
    _dirty: 0,
    _deleted: 0,
  }
}

// server row → локальный денормализованный документ шаблона
function templateRowToDoc(t) {
  const exercises = [...(t.template_exercises ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((te, i) => ({
      exercise_id: te.exercise_id,
      exercise: te.exercise
        ? {
            id: te.exercise.id,
            name: te.exercise.name,
            muscle_group: te.exercise.muscle_group ?? null,
            is_bench_lift: Boolean(te.exercise.is_bench_lift),
          }
        : { id: te.exercise_id, name: '—' },
      position: i,
    }))
  return {
    id: t.id,
    user_id: t.user_id,
    name: t.name,
    created_at: t.created_at ?? nowIso(),
    updated_at: t.created_at ?? nowIso(),
    exercises,
    _dirty: 0,
    _deleted: 0,
  }
}

async function pull(userId) {
  // справочник упражнений. НЕ затираем локально созданные упражнения, которые
  // ещё не доехали до сервера (_dirty=1) — иначе своё упражнение пропадёт из
  // пикера до завершения синка.
  const ex = await withTimeout(
    supabase.from('exercises').select('id, name, muscle_group, is_bench_lift, is_custom')
  )
  if (!ex.error && ex.data) {
    const serverExIds = new Set(ex.data.map((e) => e.id))
    await db.transaction('rw', db.exercises, async () => {
      const dirty = await db.exercises.filter((e) => e._dirty).toArray()
      await db.exercises.clear()
      await db.exercises.bulkPut(ex.data)
      // вернуть несинхронизированные локальные упражнения, если сервер их ещё не знает
      for (const e of dirty) if (!serverExIds.has(e.id)) await db.exercises.put(e)
    })
  }

  // пользователи (для офлайн-входа)
  // ВАЖНО: включаем pin_salt — иначе sync затирал бы соль в локальном кэше,
  // и следующий вход уходил бы в legacy SHA-256 → ложный «неверный PIN».
  const us = await withTimeout(supabase.from('users').select('id, name, pin_hash, pin_salt, role'))
  if (!us.error && us.data) {
    await db.transaction('rw', db.users, async () => {
      await db.users.clear()
      await db.users.bulkPut(us.data)
    })
  }

  // тренировки пользователя
  const wk = await withTimeout(
    supabase
      .from('workouts')
      .select(SELECT_WORKOUT)
      .eq('user_id', userId)
      .order('performed_at', { ascending: false })
      .limit(PULL_LIMIT)
  )
  if (wk.error) throw wk.error
  const serverRows = wk.data ?? []
  const serverIds = new Set(serverRows.map((r) => r.id))

  // Если набралась полная страница — за окном могут быть ещё тренировки, которые
  // мы не тянули. Их нельзя считать «удалёнными на сервере». Граница окна — самая
  // старая подтянутая дата (выборка идёт по убыванию performed_at).
  const partial = serverRows.length === PULL_LIMIT
  const boundary = partial ? serverRows[serverRows.length - 1].performed_at : null

  await db.transaction('rw', db.workouts, async () => {
    // Не трогаем записи с несинхронизированными правками/удалением
    const locals = await db.workouts.where('user_id').equals(userId).toArray()
    const protectedIds = new Set(locals.filter((w) => w._dirty || w._deleted).map((w) => w.id))

    for (const row of serverRows) {
      if (protectedIds.has(row.id)) continue
      await db.workouts.put(rowToDoc(row))
    }
    // Удалённые на сервере (и чистые локально) — убираем локально, но только в
    // пределах подтянутого окна: записи старше границы мы просто не запрашивали.
    for (const w of locals) {
      if (serverIds.has(w.id) || w._dirty || w._deleted) continue
      if (partial && cmpIsoAsc(w.performed_at, boundary) < 0) continue
      await db.workouts.delete(w.id)
    }
  })

  // шаблоны пользователя (их мало — тянем всё окно по user_id целиком,
  // без partial-границы). Не затираем локальные несинхронизированные изменения.
  const tpl = await withTimeout(
    supabase.from('workout_templates').select(SELECT_TEMPLATE).eq('user_id', userId)
  )
  if (!tpl.error && tpl.data) {
    const tplIds = new Set(tpl.data.map((r) => r.id))
    await db.transaction('rw', db.templates, async () => {
      const locals = await db.templates.where('user_id').equals(userId).toArray()
      const protectedIds = new Set(
        locals.filter((t) => t._dirty || t._deleted).map((t) => t.id)
      )
      for (const row of tpl.data) {
        if (protectedIds.has(row.id)) continue
        await db.templates.put(templateRowToDoc(row))
      }
      // удалить локально чистые шаблоны, которых нет на сервере
      for (const t of locals) {
        if (tplIds.has(t.id) || t._dirty || t._deleted) continue
        await db.templates.delete(t.id)
      }
    })
  }
}

// ------------------------------- push --------------------------------------

// Отправляем пользовательские упражнения (ex_outbox) в Supabase. Идёт ПЕРЕД
// push() тренировок: запись может ссылаться на свежесозданное упражнение (FK),
// поэтому упражнение должно появиться на сервере первым. Upsert по id
// идемпотентен — повторная отправка после обрыва безопасна.
async function pushExercises() {
  const ops = await db.ex_outbox.orderBy('seq').toArray()
  for (const op of ops) {
    if (op._dead) continue // отравленная операция — пропускаем, очередь не блокируем
    try {
      const ex = await db.exercises.get(op.exerciseId)
      if (!ex) {
        await db.ex_outbox.delete(op.seq)
        continue
      }
      const { error } = await withTimeout(
        supabase.from('exercises').upsert(
          {
            id: ex.id,
            name: ex.name,
            muscle_group: ex.muscle_group ?? null,
            is_custom: true,
            is_bench_lift: Boolean(ex.is_bench_lift),
          },
          { onConflict: 'id' }
        )
      )
      if (error) throw error
      await db.exercises.update(ex.id, { _dirty: 0 })
      await db.ex_outbox.delete(op.seq)
    } catch (err) {
      const attempts = (op.attempts ?? 0) + 1
      const dead = attempts >= MAX_ATTEMPTS
      await db.ex_outbox.update(op.seq, {
        attempts,
        lastError: String(err?.message ?? err),
        ...(dead ? { _dead: 1 } : {}),
      })
      if (dead) continue // в dead-letter — не вешаем очередь, идём дальше
      throw err // прекращаем проход, попробуем позже
    }
  }
}

// Отправляем шаблоны (tpl_outbox) в Supabase. Идёт ПОСЛЕ pushExercises и ДО
// push() тренировок: template_exercises.exercise_id ссылается на exercises (FK),
// поэтому упражнение должно появиться на сервере раньше шаблона. Upsert по
// клиентскому id идемпотентен — повтор после обрыва безопасен.
async function pushTemplates() {
  const ops = await db.tpl_outbox.orderBy('seq').toArray()
  for (const op of ops) {
    if (op._dead) continue // отравленная операция — пропускаем, очередь не блокируем
    try {
      if (op.type === 'upsert') {
        const doc = await db.templates.get(op.templateId)
        if (!doc || doc._deleted) {
          await db.tpl_outbox.delete(op.seq)
          continue
        }
        const exerciseIds = [...(doc.exercises ?? [])]
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((e) => e.exercise_id)
        const { error } = await withTimeout(
          supabase.rpc('upsert_template', {
            p_template_id: doc.id,
            p_user_id: doc.user_id,
            p_name: doc.name,
            p_exercise_ids: exerciseIds,
          })
        )
        if (error) throw error
        await db.templates.update(doc.id, { _dirty: 0 })
        await db.tpl_outbox.delete(op.seq)
      } else if (op.type === 'delete') {
        const { error } = await withTimeout(
          supabase.from('workout_templates').delete().eq('id', op.templateId)
        )
        if (error) throw error
        await db.templates.delete(op.templateId)
        await db.tpl_outbox.delete(op.seq)
      }
    } catch (err) {
      const attempts = (op.attempts ?? 0) + 1
      const dead = attempts >= MAX_ATTEMPTS
      await db.tpl_outbox.update(op.seq, {
        attempts,
        lastError: String(err?.message ?? err),
        ...(dead ? { _dead: 1 } : {}),
      })
      if (dead) continue // в dead-letter — не вешаем очередь, идём дальше
      throw err // прекращаем проход, попробуем позже
    }
  }
}

// Отправляем очередь по порядку. На первой же ошибке прекращаем — сохранится
// порядок и не словим частичную отправку при недоступной сети.
async function push() {
  const ops = await db.outbox.orderBy('seq').toArray()
  for (const op of ops) {
    if (op._dead) continue // отравленная операция — пропускаем, очередь не блокируем
    try {
      if (op.type === 'upsert') {
        const doc = await db.workouts.get(op.workoutId)
        if (!doc || doc._deleted) {
          await db.outbox.delete(op.seq)
          continue
        }
        const payload = doc.entries.map((e) => ({
          exercise_id: e.exercise_id,
          sets: e.sets.map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) })),
        }))
        const { error } = await withTimeout(
          supabase.rpc('upsert_workout', {
            p_workout_id: doc.id,
            p_user_id: doc.user_id,
            p_performed_at: doc.performed_at,
            p_entries: payload,
          })
        )
        if (error) throw error
        await db.workouts.update(doc.id, { _dirty: 0 })
        await db.outbox.delete(op.seq)
      } else if (op.type === 'delete') {
        const { error } = await withTimeout(
          supabase.from('workouts').delete().eq('id', op.workoutId)
        )
        if (error) throw error
        await db.workouts.delete(op.workoutId)
        await db.outbox.delete(op.seq)
      }
    } catch (err) {
      const attempts = (op.attempts ?? 0) + 1
      const dead = attempts >= MAX_ATTEMPTS
      await db.outbox.update(op.seq, {
        attempts,
        lastError: String(err?.message ?? err),
        ...(dead ? { _dead: 1 } : {}),
      })
      if (dead) continue // в dead-letter — не вешаем очередь, идём дальше
      throw err // прекращаем проход, попробуем позже
    }
  }
}

// ------------------------------- цель --------------------------------------
// Личная цель (ЛК) живёт в meta (goal_${userId}). Для фазы 2b её надо отдать
// на сервер, чтобы достижение увидел Telegram-бот. Пуш — только при _dirty
// (пользователь поставил/сменил цель); сервер через upsert_goal сбрасывает
// achieved_at при смене цели и возвращает актуальную строку. Всё обёрнуто в
// try/catch на стороне вызова: если goals.sql ещё не задеплоен (RPC нет) —
// синхронизация тренировок не должна падать.

async function pushGoal(userId) {
  const goal = await getMeta(goalKey(userId))
  if (!goal || !goal._dirty || !goal.exerciseId || !(Number(goal.targetWeight) > 0)) return
  const res = await withTimeout(
    supabase.rpc('upsert_goal', {
      p_user_id: userId,
      p_exercise_id: goal.exerciseId,
      p_target_weight: Number(goal.targetWeight),
    })
  )
  if (res.error) throw res.error
  const row = Array.isArray(res.data) ? res.data[0] : res.data
  await setMeta(goalKey(userId), {
    ...goal,
    _dirty: 0,
    achievedAt: row?.achieved_at ?? goal.achievedAt ?? null,
  })
}

// Подтягиваем серверный achieved_at в локальную цель (мульти-устройство и
// подтверждение от бота). Не трогаем цель, пока она не отправлена (_dirty),
// и никогда не гасим уже выставленный локально achievedAt (?? local).
async function pullGoal(userId) {
  const local = await getMeta(goalKey(userId))
  if (!local || local._dirty) return
  const res = await withTimeout(
    supabase.from('goals').select('achieved_at').eq('user_id', userId).maybeSingle()
  )
  if (res.error || !res.data) return
  const achievedAt = res.data.achieved_at ?? local.achievedAt ?? null
  if (achievedAt !== (local.achievedAt ?? null)) {
    await setMeta(goalKey(userId), { ...local, achievedAt })
  }
}

// --------------------------- оркестрация -----------------------------------
let running = false

// Полный цикл: сначала отдаём локальные изменения, затем забираем серверные.
export async function syncNow(userId) {
  if (!isConfigured || !navigator.onLine || running || !userId) return
  running = true
  setState({ syncing: true })
  try {
    await pushExercises() // упражнения раньше всего (FK на exercise_id)
    await pushTemplates() // шаблоны после упражнений (FK), до/после тренировок неважно
    await push()
    // Цель (ЛК 2b) — необязательная часть: ошибка/отсутствие RPC не должны
    // ронять синхронизацию тренировок, поэтому отдельный try/catch.
    try { await pushGoal(userId) } catch { /* goals.sql может быть ещё не задеплоен */ }
    await pull(userId)
    try { await pullGoal(userId) } catch { /* цель не критична для синка */ }
    // Обновляем кэш общей ленты в фоне: его читают и «Лента», и бейджи-
    // уведомления о рекордах («друг побил твой рекорд» — из ленты). Ошибка ленты
    // не должна валить синк своих тренировок, поэтому отдельный try/catch.
    try { await fetchFeed() } catch { /* лента не критична для синка */ }
    const at = nowIso()
    await setMeta('lastSyncAt', at)
    setState({ lastError: null, lastSyncAt: at })
  } catch (err) {
    setState({ lastError: String(err?.message ?? err) })
  } finally {
    running = false
    setState({ syncing: false, online: navigator.onLine })
  }
}

// Запускаем фоновую синхронизацию для пользователя. Возвращает функцию остановки.
export function startSync(getUserId) {
  // Подписки через общий хаб событий (см. lib/appEvents.js): DOM-слушатели там
  // регистрируются один раз на всё приложение.
  const offOnline = onOnline(() => {
    setState({ online: true })
    syncNow(getUserId())
  })
  const offOffline = onOffline(() => setState({ online: false }))
  const offResume = onResume(() => syncNow(getUserId()))
  const timer = setInterval(() => syncNow(getUserId()), POLL_MS)

  syncNow(getUserId()) // первый прогон сразу

  return () => {
    offOnline()
    offOffline()
    offResume()
    clearInterval(timer)
  }
}

// ------------------------------- хук ---------------------------------------
// Статус для UI: онлайн/офлайн, идёт ли синк, сколько изменений в очереди.
export function useSyncStatus() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const pending = useLiveQuery(() => pendingCount(), [], 0)
  return { ...s, pending: pending ?? 0 }
}
