// ============================================================================
// Реакции на мои комментарии для «Уведомлений» (26.10.2026, fb_76d747a2). Слой витрин:
// read-only RPC my_comment_reactions (migrations/20261026140000_comment_reaction_notifs.sql)
// под RLS-личностью, результат — КЭШ в персональном meta (`cmt_react_${userId}`), как ответы
// разработчика в db/feedbackReplies.js. Снимок сервера, а не пользовательская сущность: в
// user_meta не синкается, на другом устройстве соберется при первой подтяжке Ленты.
// comments_for отдает только счетчики по видам — «кто и когда» есть лишь здесь.
// ============================================================================
import { db, getMeta, setMeta } from './local.js'
import { supabase, isConfigured, hasSession } from './supabase.js'
import { withTimeout } from '../lib/withTimeout.js'
import { commentReactionNotifs } from '../lib/commentNotifs.js'

export const commentReactionsKey = (userId) => `cmt_react_${userId}`

// Подтянуть с сервера (зовет fetchFeed вместе с реакциями и комментариями окна). Тихо: офлайн,
// чужая сессия, сервер без функции, сбой — кэш как был. Пишем только при изменении, чтобы поллинг
// Ленты не будил счетчик уведомлений вхолостую.
export async function refreshCommentReactions(userId, d = db) {
  if (!d || !userId || !isConfigured || !navigator.onLine) return
  try {
    if (!(await hasSession(userId))) return
    const res = await withTimeout(supabase.rpc('my_comment_reactions', { p_limit: 40 }))
    if (res.error || !Array.isArray(res.data)) return
    // Пока шел запрос, могли войти под другой учеткой — в чужую базу не пишем.
    if (d !== db) return
    const next = commentReactionNotifs(res.data)
    const key = commentReactionsKey(userId)
    if (JSON.stringify((await getMeta(key, d)) ?? []) === JSON.stringify(next)) return
    await setMeta(key, next, d)
  } catch { /* офлайн / база закрыта — без обновления */ }
}

export async function getCachedCommentReactions(userId) {
  const v = await getMeta(commentReactionsKey(userId))
  return Array.isArray(v) ? v : []
}
