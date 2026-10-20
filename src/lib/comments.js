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

// Реакции на комментарий (20.10.2026, fb_4cbd8655; сервер — migrations/20261020160000_comment_reactions.sql):
// пять видов в этом порядке (и в полоске меню, и в таблетках под пузырем), одна реакция от человека.
// Список видов — тот же, что в check-ограничении comment_likes.kind и в comment_react.
export const COMMENT_REACTIONS = [
  { kind: 'heart', emoji: '❤️', label: 'Сердце' },
  { kind: 'laugh', emoji: '😂', label: 'Смешно' },
  { kind: 'like', emoji: '👍', label: 'Класс' },
  { kind: 'fire', emoji: '🔥', label: 'Огонь' },
  { kind: 'wow', emoji: '😮', label: 'Ого' },
]
const REACTION_KINDS = new Set(COMMENT_REACTIONS.map((r) => r.kind))
export const isCommentReaction = (k) => REACTION_KINDS.has(k)

// Счетчики по видам из строки сервера. Сервер без реакций (до миграции) — все лайки считаем сердцами.
function readReactions(r) {
  const out = {}
  const raw = r?.reactions
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const n = Math.max(0, Math.floor(Number(v) || 0))
      if (isCommentReaction(k) && n > 0) out[k] = n
    }
    return out
  }
  const n = Math.max(0, Number(r?.like_count) || 0)
  if (n > 0) out.heart = n
  return out
}
function readMine(r) {
  if (r?.reactions !== undefined) return isCommentReaction(r?.my_reaction) ? r.my_reaction : null
  return r?.liked ? 'heart' : null
}

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
    // Реакции (20261020160000): { вид: число } и своя (вид или null).
    reactions: readReactions(r),
    my_reaction: readMine(r),
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

// Реакция — на чужой комментарий; на своем — только счетчики (как самолайк тренировки).
export function canReactComment(c, myId) {
  return Boolean(myId) && Boolean(c?.user_id) && c.user_id !== myId
}

// Ответить — на любой, и на свой тоже (fb_4cbd8655): сервер это пускает, пуш себе не шлет.
export function canReplyComment(c, myId) {
  return Boolean(myId) && Boolean(c?.user_id)
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

// Серии пузырей (fb_830c22d6): подряд от одного автора с паузой не больше SERIES_GAP_MS —
// один блок: имя у первого пузыря, аватар у последнего. Ответ начинает новую серию (над ним цитата).
// → [{ first, last }] по индексам списка.
export const SERIES_GAP_MS = 5 * 60 * 1000
export function commentSeries(list) {
  const all = list ?? []
  const joins = (a, b) => {
    if (!a || !b || b.reply_to_user) return false
    if ((a.user_id ?? a.name) !== (b.user_id ?? b.name)) return false
    const ta = Date.parse(a.created_at ?? ''), tb = Date.parse(b.created_at ?? '')
    return Number.isFinite(ta) && Number.isFinite(tb) && tb - ta <= SERIES_GAP_MS
      && commentDayKey(a.created_at) === commentDayKey(b.created_at)
  }
  return all.map((c, i) => ({ first: !joins(all[i - 1], c), last: !joins(c, all[i + 1]) }))
}

// Цвет имени автора — один из NAME_TONES по id (у человека всегда один цвет).
export const NAME_TONES = 7
export function nameTone(key) {
  const s = String(key ?? '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return (h % NAME_TONES) + 1
}

// Время в углу пузыря — по часам (fb_afd6d919): «14:05». День — плашкой между днями.
export function commentClock(iso) {
  const t = Date.parse(iso ?? '')
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

// Локальный день комментария ('' — нет даты): по нему плашки дней и границы серий.
export function commentDayKey(iso) {
  const t = Date.parse(iso ?? '')
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

// Плашка дня: «Сегодня», «Вчера», «17 октября» (другой год — с годом).
export function commentDayLabel(iso, now = Date.now()) {
  const t = Date.parse(iso ?? '')
  if (!Number.isFinite(t)) return ''
  const key = commentDayKey(iso)
  const today = new Date(now)
  if (key === commentDayKey(today.toISOString())) return 'Сегодня'
  const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (key === commentDayKey(y.toISOString())) return 'Вчера'
  const d = new Date(t)
  const opts = d.getFullYear() === today.getFullYear() ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' }
  return d.toLocaleDateString('ru-RU', opts).replace(' г.', '')
}

// Плашки дней над комментариями: перед первым каждого нового дня; перед самым первым — только если он не
// сегодняшний (под «Началом обсуждения» «Сегодня» лишнее). → [label | null] по индексам.
export function commentDayBreaks(list, now = Date.now()) {
  const all = list ?? []
  return all.map((c, i) => {
    if (c.pending) return null
    const key = commentDayKey(c.created_at)
    if (!key) return null
    if (i === 0) return commentDayLabel(c.created_at, now) === 'Сегодня' ? null : commentDayLabel(c.created_at, now)
    return key === commentDayKey(all[i - 1].created_at) ? null : commentDayLabel(c.created_at, now)
  })
}

// Двойной тап — быстрая ❤️ (fb_afd6d919): второй тап по тому же пузырю не позже DOUBLE_TAP_MS.
export const DOUBLE_TAP_MS = 320
export function isDoubleTap(prev, id, t) {
  return Boolean(prev) && prev.id === id && t - prev.t >= 0 && t - prev.t <= DOUBLE_TAP_MS
}

// Таблетки под пузырем: виды с реакциями в порядке COMMENT_REACTIONS → [{ kind, emoji, count, mine }].
export function reactionPills(c) {
  const counts = c?.reactions ?? {}
  return COMMENT_REACTIONS
    .filter((r) => counts[r.kind] > 0)
    .map((r) => ({ ...r, count: counts[r.kind], mine: c?.my_reaction === r.kind }))
}

// Что поставить по нажатию на вид: тот же, что уже стоит, — снять (null), иначе — этот вид.
export function nextReaction(c, kind) {
  return c?.my_reaction === kind ? null : kind
}

// Оптимистичная реакция: kind — новый вид или null (снять). Одна от человека: прежняя уходит.
// → { reactions, my_reaction, like_count, liked } (последние два — сумма по видам, для старого контракта).
export function applyReaction(c, kind) {
  const reactions = { ...(c?.reactions ?? {}) }
  const was = c?.my_reaction ?? null
  const next = isCommentReaction(kind) ? kind : null
  if (was && was !== next) {
    reactions[was] = Math.max(0, (reactions[was] ?? 0) - 1)
    if (!reactions[was]) delete reactions[was]
  }
  if (next && was !== next) reactions[next] = (reactions[next] ?? 0) + 1
  const total = Object.values(reactions).reduce((a, n) => a + n, 0)
  return { reactions, my_reaction: next, like_count: total, liked: Boolean(next) }
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
  if (m.includes('comment_own_like')) return 'На свой комментарий реакцию не поставить.'
  if (m.includes('comment_bad_reaction')) return 'Такой реакции нет — обнови приложение.'
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

// Реакция: kind — вид или null (снять) → { reactions, my_reaction, like_count, liked } с сервера.
export async function reactComment(userId, commentId, kind) {
  const next = isCommentReaction(kind) ? kind : null
  const data = await rpc(userId, 'comment_react', { p_id: commentId, p_kind: next })
  const r = Array.isArray(data) ? data[0] : data
  return {
    reactions: readReactions({ reactions: r?.reactions ?? {} }),
    my_reaction: isCommentReaction(r?.my_reaction) ? r.my_reaction : null,
    like_count: Math.max(0, Number(r?.like_count) || 0),
    liked: Boolean(r?.liked),
  }
}

// Удалить → true; false — уже удален или нет прав.
export async function deleteComment(userId, commentId) {
  return Boolean(await rpc(userId, 'comment_delete', { p_id: commentId }))
}
