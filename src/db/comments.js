// ============================================================================
// Комментарии к тренировкам — обвязка кэша (19.10.2026, PLAN-comments.md).
// Сеть — lib/comments.js (онлайн, вне очередей синка). Здесь: после успешной отправки
// или удаления правим снимки Ленты (`feed`) и профиля участника (`member_<id>` в meta),
// чтобы экран обновился сразу, а не со следующим опросом.
//
// Свежие правки помним в памяти пару минут и накладываем на ответ comments_for
// (overlayRecentComments): опрос, ушедший ДО отправки, иначе вернул бы снимок без
// нового комментария, и он «мигнул» бы до следующего опроса (тот же случай, что
// fb_53077e01 у реакций). Так же — правка текста и ❤️ (9.5.3): накладываются полями на
// уже пришедший комментарий (recentPatches), не подменяя остальное.
// ============================================================================
import { db, getMeta, setMeta } from './local.js'
import { addComment, deleteComment, editComment, reactComment, upsertComment } from '../lib/comments.js'

const RECENT_MS = 2 * 60 * 1000
const recentAdds = new Map() // id → { c, at }
const recentDeletes = new Map() // id → at
const recentPatches = new Map() // id → { patch, at } — правка текста / ❤️

function prune(now) {
  for (const [id, v] of recentAdds) if (now - v.at > RECENT_MS) recentAdds.delete(id)
  for (const [id, at] of recentDeletes) if (now - at > RECENT_MS) recentDeletes.delete(id)
  for (const [id, v] of recentPatches) if (now - v.at > RECENT_MS) recentPatches.delete(id)
}

function patchOne(id, patch) {
  const prev = recentPatches.get(id)?.patch ?? {}
  recentPatches.set(id, { patch: { ...prev, ...patch }, at: Date.now() })
}

// Наложить свежие локальные правки на серверный снимок. Мутирует item.comments.
export function overlayRecentComments(items, now = Date.now()) {
  prune(now)
  if (!recentAdds.size && !recentDeletes.size && !recentPatches.size) return
  for (const item of items ?? []) {
    let list = (item.comments ?? []).filter((c) => !recentDeletes.has(c.id))
    for (const { c } of recentAdds.values()) {
      if (c.workout_id === item.id && !recentDeletes.has(c.id)) list = upsertComment(list, c)
    }
    if (recentPatches.size) list = list.map((c) => (recentPatches.has(c.id) ? { ...c, ...recentPatches.get(c.id).patch } : c))
    item.comments = list
  }
}

// Для тестов.
export function resetRecentComments() {
  recentAdds.clear()
  recentDeletes.clear()
  recentPatches.clear()
}

async function patchCaches(workoutId, ownerId, fn, d = db) {
  if (!d) return
  try {
    const item = await d.feed.get(workoutId)
    if (item) await d.feed.put({ ...item, comments: fn(item.comments ?? []) })
  } catch { /* кэш Ленты недоступен — обновится опросом */ }
  if (!ownerId) return
  const key = `member_${ownerId}`
  const cached = await getMeta(key, d)
  if (!cached?.items?.some((i) => i.id === workoutId)) return
  const items = cached.items.map((i) => (i.id === workoutId ? { ...i, comments: fn(i.comments ?? []) } : i))
  await setMeta(key, { ...cached, items }, d)
}

// Отправить (replyTo — исходный комментарий, если это ответ) → комментарий с сервера
// (ошибку бросает CommentError с понятным текстом).
export async function postComment({ userId, workoutId, ownerId, text, replyTo = null }, d = db) {
  const c = await addComment(userId, workoutId, text, replyTo?.id ?? null)
  recentAdds.set(c.id, { c, at: Date.now() })
  await patchCaches(workoutId, ownerId, (list) => upsertComment(list, c), d)
  return c
}

// Изменить свой → новые { body, edited_at }; лайки и остальное остаются.
export async function updateComment({ userId, comment, ownerId, text }, d = db) {
  const patch = await editComment(userId, comment.id, text)
  patchOne(comment.id, patch)
  await patchCaches(comment.workout_id, ownerId, (list) => list.map((x) => (x.id === comment.id ? { ...x, ...patch } : x)), d)
  return patch
}

// Реакция: kind — вид или null (снять) → { reactions, my_reaction, like_count, liked } с сервера.
export async function setCommentReaction({ userId, comment, ownerId, kind }, d = db) {
  const patch = await reactComment(userId, comment.id, kind)
  patchOne(comment.id, patch)
  await patchCaches(comment.workout_id, ownerId, (list) => list.map((x) => (x.id === comment.id ? { ...x, ...patch } : x)), d)
  return patch
}

// Удалить. Уже удален (false с сервера) — тоже убираем из кэша.
export async function removeComment({ userId, comment, ownerId }, d = db) {
  await deleteComment(userId, comment.id)
  recentDeletes.set(comment.id, Date.now())
  recentAdds.delete(comment.id)
  recentPatches.delete(comment.id)
  await patchCaches(comment.workout_id, ownerId, (list) => list.filter((x) => x.id !== comment.id), d)
}
