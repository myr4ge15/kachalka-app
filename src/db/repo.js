// ============================================================================
// Репозиторий данных — единственный API, которым пользуются экраны.
//
// Читает и пишет ТОЛЬКО в локальную базу (Dexie). Любая запись:
//   1) обновляет документ тренировки в `workouts` (UI меняется мгновенно);
//   2) ставит операцию в очередь `outbox` (несинхронизированные изменения).
// Сеть здесь не трогаем вообще — отправкой очереди занимается src/db/sync.js.
//
// Каноничный документ тренировки:
//   {
//     id, user_id, performed_at, updated_at,
//     _dirty, _deleted,
//     entries: [
//       { exercise_id, exercise: {id,name,muscle_group,is_bench_lift},
//         sets: [ { weight, reps } ] }
//     ]
//   }
// ============================================================================
import { db, newId, nowIso } from './local.js'

// ----------------------------- Чтение --------------------------------------

// Справочник упражнений (из локального кэша).
export async function getExercises() {
  const list = await db.exercises.toArray()
  return list.sort(
    (a, b) =>
      String(a.muscle_group ?? '').localeCompare(String(b.muscle_group ?? '')) ||
      String(a.name ?? '').localeCompare(String(b.name ?? ''))
  )
}

// Пользователи (для офлайн-входа по PIN).
export async function getUsers() {
  const list = await db.users.toArray()
  return list.sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

// Сохранить список пользователей в кэш (вызывает экран входа, пока синк не запущен).
export async function cacheUsers(list) {
  if (!Array.isArray(list)) return
  await db.transaction('rw', db.users, async () => {
    await db.users.clear()
    await db.users.bulkPut(list)
  })
}

// Тренировки пользователя (без удалённых), свежие сверху.
export async function getWorkouts(userId) {
  const list = await db.workouts.where('user_id').equals(userId).toArray()
  return list
    .filter((w) => !w._deleted)
    .sort((a, b) => String(b.performed_at).localeCompare(String(a.performed_at)))
}

// ----------------------------- Запись --------------------------------------

// Нормализуем подходы из формы (строки из input) в числа.
function cleanEntries(entries) {
  return (entries ?? [])
    .map((e) => ({
      exercise_id: e.exercise?.id ?? e.exercise_id,
      exercise: e.exercise
        ? {
            id: e.exercise.id,
            name: e.exercise.name,
            muscle_group: e.exercise.muscle_group ?? null,
            is_bench_lift: Boolean(e.exercise.is_bench_lift),
          }
        : undefined,
      sets: (e.sets ?? [])
        .map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) }))
        .filter((s) => Number.isFinite(s.weight) && Number.isFinite(s.reps) && s.reps > 0),
    }))
    .filter((e) => e.exercise_id && e.sets.length > 0)
}

// Создать новую или переписать существующую тренировку.
// Возвращает id. Передай существующий id, чтобы отредактировать.
export async function saveWorkout({ id, user_id, performed_at, entries }) {
  const cleaned = cleanEntries(entries)
  if (cleaned.length === 0) throw new Error('Пустая тренировка: добавь хотя бы один подход.')

  const wId = id ?? newId()
  const now = nowIso()

  await db.transaction('rw', db.workouts, db.outbox, async () => {
    const existing = id ? await db.workouts.get(id) : null
    const doc = {
      id: wId,
      user_id,
      performed_at: performed_at ?? existing?.performed_at ?? now,
      updated_at: now,
      entries: cleaned,
      _dirty: 1,
      _deleted: 0,
    }
    await db.workouts.put(doc)
    await enqueue('upsert', wId)
  })

  return wId
}

// Удалить тренировку. Помечаем tombstone и ставим в очередь удаление.
export async function deleteWorkout(id) {
  await db.transaction('rw', db.workouts, db.outbox, async () => {
    const doc = await db.workouts.get(id)
    if (!doc) return
    await db.workouts.update(id, { _deleted: 1, _dirty: 0, updated_at: nowIso() })
    await enqueue('delete', id)
  })
}

// ------------------------- Очередь (outbox) --------------------------------
// Схлопываем дубли по тренировке, чтобы очередь не разрасталась:
//  - upsert поверх upsert → одна операция (push всегда читает свежий документ);
//  - delete отменяет ожидающие upsert той же тренировки;
//  - upsert после delete (повторное создание) → заменяет delete на upsert.
async function enqueue(type, workoutId) {
  const pending = await db.outbox.where('workoutId').equals(workoutId).toArray()
  if (type === 'upsert') {
    if (pending.some((o) => o.type === 'upsert')) return
    // если был delete — снимаем его, ставим upsert
    for (const o of pending) if (o.type === 'delete') await db.outbox.delete(o.seq)
    await db.outbox.add({ workoutId, type, createdAt: nowIso(), attempts: 0 })
  } else {
    // delete: убираем все upsert этой тренировки
    for (const o of pending) if (o.type === 'upsert') await db.outbox.delete(o.seq)
    if (pending.some((o) => o.type === 'delete')) return
    await db.outbox.add({ workoutId, type, createdAt: nowIso(), attempts: 0 })
  }
}

// Сколько изменений ждут отправки.
export async function pendingCount() {
  return db.outbox.count()
}
