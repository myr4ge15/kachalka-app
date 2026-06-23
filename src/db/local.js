// ============================================================================
// Локальная база (IndexedDB через Dexie) — источник правды для UI.
//
// Идея офлайн-first: экраны читают/пишут ТОЛЬКО сюда и обновляются мгновенно.
// Отдельный движок синхронизации (src/db/sync.js) в фоне:
//   - тянет свежие данные с Supabase в эти таблицы (pull);
//   - отправляет несинхронизированные изменения из очереди `outbox` (push).
//
// Тренировка хранится денормализованно — одним документом с вложенными
// упражнениями и подходами. Так UI (история, прогресс, правка) работает без
// JOIN-ов, а синк отправляет/принимает запись целиком.
// ============================================================================
import Dexie from 'dexie'

export const db = new Dexie('gym_app')

// Индексируем поля, по которым фильтруем/сортируем. Булевы флаги храним как
// 0/1 (Dexie не индексирует true/false) — это и есть «очередь несинхрон.».
db.version(1).stores({
  // Справочник упражнений (кэш для офлайн-пикера)
  exercises: 'id, muscle_group, name',

  // Пользователи (кэш для офлайн-входа по PIN)
  users: 'id, name',

  // Тренировки — денормализованные документы.
  //   _dirty   = 1 → есть локальные изменения, ждут отправки
  //   _deleted = 1 → удалена локально, ждёт удаления на сервере (tombstone)
  workouts: 'id, user_id, performed_at, _dirty, _deleted',

  // Очередь несинхронизированных операций (FIFO по автоинкременту seq).
  //   type: 'upsert' | 'delete'
  outbox: '++seq, workoutId, type, createdAt',

  // Служебные значения (например, время последней успешной синхронизации)
  meta: 'key',
})

// v2: кэш общей ленты тренировок друзей (read-only снимок с сервера).
// Храним отдельно от `workouts` (там только свои записи, с правкой и очередью).
// Лента — это последние тренировки ВСЕХ пользователей; кэшируем, чтобы экран
// открывался мгновенно и что-то показывал офлайн.
db.version(2).stores({
  exercises: 'id, muscle_group, name',
  users: 'id, name',
  workouts: 'id, user_id, performed_at, _dirty, _deleted',
  outbox: '++seq, workoutId, type, createdAt',
  meta: 'key',
  feed: 'id, performed_at',
})

// v3: пользовательские упражнения (ТЗ 3.2 / 4.4 — «добавить своё»).
//   - exercises получает индекс `_dirty` (1 → создано локально, ждёт отправки),
//     чтобы pull не затирал ещё не синхронизированные упражнения;
//   - ex_outbox — отдельная очередь на upsert упражнений в Supabase.
// Очередь упражнений отправляется ПЕРЕД очередью тренировок: тренировка может
// ссылаться на свежесозданное упражнение (FK), оно должно появиться на сервере
// раньше. Старый `outbox` (тренировки) не трогаем.
db.version(3).stores({
  exercises: 'id, muscle_group, name, _dirty',
  users: 'id, name',
  workouts: 'id, user_id, performed_at, _dirty, _deleted',
  outbox: '++seq, workoutId, type, createdAt',
  meta: 'key',
  feed: 'id, performed_at',
  ex_outbox: '++seq, exerciseId, createdAt',
})

// Текущее серверное (UTC) время в ISO. crypto.randomUUID доступен на https и localhost.
export const nowIso = () => new Date().toISOString()
export const newId = () =>
  (crypto?.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      }))

export async function getMeta(key) {
  const row = await db.meta.get(key)
  return row?.value
}
export async function setMeta(key, value) {
  await db.meta.put({ key, value })
}
