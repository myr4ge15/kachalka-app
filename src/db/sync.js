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
import { db, nowIso, setMeta } from './local.js'
import { pendingCount } from './repo.js'

const POLL_MS = 20000
const SELECT_WORKOUT =
  'id, performed_at, user_id, ' +
  'workout_exercises(id, position, exercise_id, ' +
  'exercise:exercises(id, name, muscle_group, is_bench_lift), ' +
  'sets(id, set_number, weight, reps))'

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
    updated_at: w.performed_at,
    entries,
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
  const us = await withTimeout(supabase.from('users').select('id, name, pin_hash, role'))
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
  )
  if (wk.error) throw wk.error
  const serverRows = wk.data ?? []
  const serverIds = new Set(serverRows.map((r) => r.id))

  await db.transaction('rw', db.workouts, async () => {
    // Не трогаем записи с несинхронизированными правками/удалением
    const locals = await db.workouts.where('user_id').equals(userId).toArray()
    const protectedIds = new Set(locals.filter((w) => w._dirty || w._deleted).map((w) => w.id))

    for (const row of serverRows) {
      if (protectedIds.has(row.id)) continue
      await db.workouts.put(rowToDoc(row))
    }
    // Удалённые на сервере (и чистые локально) — убираем локально
    for (const w of locals) {
      if (!serverIds.has(w.id) && !w._dirty && !w._deleted) {
        await db.workouts.delete(w.id)
      }
    }
  })
}

// ------------------------------- push --------------------------------------

// Отправляем пользовательские упражнения (ex_outbox) в Supabase. Идёт ПЕРЕД
// push() тренировок: запись может ссылаться на свежесозданное упражнение (FK),
// поэтому упражнение должно появиться на сервере первым. Upsert по id
// идемпотентен — повторная отправка после обрыва безопасна.
async function pushExercises() {
  const ops = await db.ex_outbox.orderBy('seq').toArray()
  for (const op of ops) {
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
      await db.ex_outbox.update(op.seq, {
        attempts: (op.attempts ?? 0) + 1,
        lastError: String(err?.message ?? err),
      })
      throw err // прекращаем проход, попробуем позже
    }
  }
}

// Отправляем очередь по порядку. На первой же ошибке прекращаем — сохранится
// порядок и не словим частичную отправку при недоступной сети.
async function push() {
  const ops = await db.outbox.orderBy('seq').toArray()
  for (const op of ops) {
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
      await db.outbox.update(op.seq, {
        attempts: (op.attempts ?? 0) + 1,
        lastError: String(err?.message ?? err),
      })
      throw err // прекращаем проход, попробуем позже
    }
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
    await pushExercises() // упражнения раньше тренировок (FK на exercise_id)
    await push()
    await pull(userId)
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
  const onOnline = () => {
    setState({ online: true })
    syncNow(getUserId())
  }
  const onOffline = () => setState({ online: false })
  const onVisible = () => {
    if (document.visibilityState === 'visible') syncNow(getUserId())
  }

  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)
  const timer = setInterval(() => syncNow(getUserId()), POLL_MS)

  syncNow(getUserId()) // первый прогон сразу

  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisible)
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
