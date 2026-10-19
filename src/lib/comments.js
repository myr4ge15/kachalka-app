// ============================================================================
// Комментарии к тренировкам (19.10.2026; план docs/plans/PLAN-comments.md, сервер —
// supabase/migrations/20261019120000_workout_comments.sql).
// Чистая логика (строка с сервера, время, превью, права) + онлайн-операции вне очередей
// синка, как «Друзья»: комментарий — разговор сейчас, неотправленное не копим.
// Чтение — db/feed.js attachComments (одним вызовом на окно Ленты / профиля).
// ============================================================================
import { supabase, hasSession } from '../db/supabase.js'
import { withTimeout } from './withTimeout.js'

export const COMMENT_MAX = 500
// Счетчик знаков под полем появляется ближе к пределу.
export const COMMENT_COUNTER_FROM = 400
// Свернутая ветка — последние N комментариев.
export const PREVIEW_COUNT = 2

// Строка comments_for / comment_add → комментарий карточки. Без id/текста — null.
export function normComment(r) {
  if (!r?.id || !r?.workout_id || typeof r.body !== 'string') return null
  return {
    id: String(r.id),
    workout_id: String(r.workout_id),
    user_id: r.user_id ? String(r.user_id) : null,
    name: (r.author_name ?? '').trim() || 'Кто-то',
    known: Boolean(r.author_known),
    avatar_url: r.author_known ? (r.author_avatar_url ?? null) : null,
    body: r.body,
    created_at: r.created_at ?? null,
    // 9.5.3: правка и ❤️. Сервер 9.5.2 (без колонок) — не правлено, лайков нет.
    edited_at: r.edited_at ?? null,
    like_count: Math.max(0, Number(r.like_count) || 0),
    liked: Boolean(r.liked),
    // Ответ (20261019235000_comment_reply.sql): на какой комментарий и кому. Исходный удалили — reply_to пуст,
    // «кому» остается; адресат в блоке со мной — имени нет. Сервер без ответов — обычный комментарий.
    reply_to: r.reply_to ? String(r.reply_to) : null,
    reply_to_user: r.reply_to_user ? String(r.reply_to_user) : null,
    reply_to_name: (r.reply_to_name ?? '').trim() || null,
  }
}

// Строки сервера → Map(workout_id → [комментарии по времени]).
export function groupComments(rows) {
  const out = new Map()
  for (const r of rows ?? []) {
    const c = normComment(r)
    if (!c) continue
    if (!out.has(c.workout_id)) out.set(c.workout_id, [])
    out.get(c.workout_id).push(c)
  }
  for (const list of out.values()) list.sort(byTime)
  return out
}

function byTime(a, b) {
  const d = Date.parse(a.created_at ?? 0) - Date.parse(b.created_at ?? 0)
  return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// Добавить/заменить комментарий в списке (по id), сохранив порядок по времени.
export function upsertComment(list, c) {
  return [...(list ?? []).filter((x) => x.id !== c.id), c].sort(byTime)
}

// Свернутая ветка: последние PREVIEW_COUNT и сколько всего скрыто.
export function previewComments(list, open) {
  const all = list ?? []
  if (open || all.length <= PREVIEW_COUNT) return { shown: all, hidden: 0 }
  return { shown: all.slice(-PREVIEW_COUNT), hidden: all.length - PREVIEW_COUNT }
}

// Удалить можно свой комментарий и любой под своей тренировкой (сервер решает так же).
export function canDeleteComment(c, myId, ownerId) {
  return Boolean(myId) && (c?.user_id === myId || ownerId === myId)
}

// Изменить — только свой (владелец тренировки чужие только удаляет).
export function canEditComment(c, myId) {
  return Boolean(myId) && c?.user_id === myId
}

// ❤️ — на чужой комментарий; свой — только счетчик (как самолайк тренировки).
export function canLikeComment(c, myId) {
  return Boolean(myId) && Boolean(c?.user_id) && c.user_id !== myId
}

// Ответить — на чужой (себе отвечать незачем).
export function canReplyComment(c, myId) {
  return Boolean(myId) && Boolean(c?.user_id) && c.user_id !== myId
}

// Цитата над ответом: имя адресата и начало исходного. Исходный в ветке — берем оттуда (свежее имя и текст),
// удален — только имя; не ответ или адресат скрыт (блок) — null.
export const QUOTE_MAX = 60
export function replyQuote(c, list) {
  if (!c?.reply_to_user) return null
  const orig = c.reply_to ? (list ?? []).find((x) => x.id === c.reply_to) : null
  const name = orig?.name ?? c.reply_to_name
  if (!name) return null
  if (!orig) return { name, text: null }
  const s = orig.body.replace(/\s+/g, ' ').trim()
  return { name, text: s.length > QUOTE_MAX ? `${s.slice(0, QUOTE_MAX - 1).trimEnd()}…` : s }
}

// Оптимистичный лайк: новое состояние счетчика.
export function toggleLike(c, on) {
  const was = Boolean(c?.liked)
  const n = Math.max(0, Number(c?.like_count) || 0)
  if (was === on) return { like_count: n, liked: was }
  return { like_count: Math.max(0, n + (on ? 1 : -1)), liked: on }
}

// Короткое время у комментария: «сейчас», «5 мин», «3 ч», «2 дн», дальше — дата.
export function commentAgo(iso, now = Date.now()) {
  const t = Date.parse(iso ?? '')
  if (!Number.isFinite(t)) return ''
  const sec = Math.max(0, Math.floor((now - t) / 1000))
  if (sec < 60) return 'сейчас'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} мин`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days} дн`
  return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
}

// Текст поля → что уйдет на сервер ('' — отправлять нечего).
export function cleanBody(text) {
  return String(text ?? '').trim()
}

export class CommentError extends Error {}

function humanError(error) {
  const m = String(error?.message ?? '')
  if (m.includes('comment_rate_limited')) return 'Слишком много комментариев за час — попробуй позже.'
  if (m.includes('comment_bad_length')) return `Комментарий — от 1 до ${COMMENT_MAX} знаков.`
  if (m.includes('comment_no_workout')) return 'Эта тренировка тебе больше не видна.'
  if (m.includes('comment_not_found')) return 'Комментарий уже удален или тебе больше не виден.'
  if (m.includes('comment_own_like')) return 'Свой комментарий лайкать нельзя.'
  if (error?.code === '42501') return 'Войди в свою учетную запись с интернетом.'
  if (error?.code === 'PGRST202') return 'Комментарии пока недоступны. Попробуй позже.'
  if (error?.code === 'PGRST301' || /jwt expired/i.test(m)) return 'Сессия устарела — закрой и снова открой приложение.'
  return 'Не получилось — попробуй еще раз.' + (error?.code ? ` (${error.code})` : '')
}

async function rpc(userId, name, args) {
  if (!navigator.onLine) throw new CommentError('Нет сети.')
  if (!await hasSession(userId)) throw new CommentError('Войди в свою учетную запись с интернетом.')
  let res
  try {
    res = await withTimeout(supabase.rpc(name, args))
  } catch {
    throw new CommentError('Нет сети — попробуй позже.')
  }
  if (res.error) throw new CommentError(humanError(res.error))
  return res.data
}

// Отправить комментарий (replyTo — id исходного, если это ответ) → готовая строка (заменяет оптимистичную).
export async function addComment(userId, workoutId, text, replyTo = null) {
  const body = cleanBody(text)
  if (!body || body.length > COMMENT_MAX) throw new CommentError(`Комментарий — от 1 до ${COMMENT_MAX} знаков.`)
  const args = { p_workout_id: workoutId, p_body: body }
  if (replyTo) args.p_reply_to = replyTo
  const data = await rpc(userId, 'comment_add', args)
  const c = normComment(Array.isArray(data) ? data[0] : data)
  if (!c) throw new CommentError('Не получилось — попробуй еще раз.')
  return c
}

// Изменить свой → строка с сервера (без лайков: их сохраняет вызывающий).
export async function editComment(userId, commentId, text) {
  const body = cleanBody(text)
  if (!body || body.length > COMMENT_MAX) throw new CommentError(`Комментарий — от 1 до ${COMMENT_MAX} знаков.`)
  const data = await rpc(userId, 'comment_edit', { p_id: commentId, p_body: body })
  const c = normComment(Array.isArray(data) ? data[0] : data)
  if (!c) throw new CommentError('Не получилось — попробуй еще раз.')
  return { body: c.body, edited_at: c.edited_at }
}

// ❤️ поставить/снять → { like_count, liked } с сервера.
export async function likeComment(userId, commentId, on) {
  const data = await rpc(userId, 'comment_like', { p_id: commentId, p_on: Boolean(on) })
  const r = Array.isArray(data) ? data[0] : data
  return { like_count: Math.max(0, Number(r?.like_count) || 0), liked: Boolean(r?.liked) }
}

// Удалить → true; false — уже удален или нет прав.
export async function deleteComment(userId, commentId) {
  return Boolean(await rpc(userId, 'comment_delete', { p_id: commentId }))
}
