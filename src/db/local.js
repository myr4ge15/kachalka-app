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
