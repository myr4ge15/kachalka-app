// ============================================================================
// Комментарии в «Уведомлениях» (26.10.2026, fb_76d747a2): пуши о них приходили, а на экране их не
// было. Чистые функции без Dexie и сети.
//   commentNotifs(items, myId) — из окна Ленты (в нем есть и мои тренировки с комментариями):
//     чужой комментарий под моей тренировкой → mode 'comment', ответ мне в любой ветке → mode 'reply'.
//   commentReactionNotifs(rows) — строки my_comment_reactions → реакции на мои комментарии.
// ============================================================================
import { COMMENT_REACTIONS } from './comments.js'

const EMOJI = new Map(COMMENT_REACTIONS.map((r) => [r.kind, r.emoji]))

export function commentNotifs(items, myId) {
  if (!Array.isArray(items) || myId == null) return []
  const out = []
  for (const it of items) {
    for (const c of it?.comments ?? []) {
      if (!c?.id || !c.created_at || c.user_id == null || c.user_id === myId) continue
      const mode = c.reply_to_user === myId ? 'reply' : it.user_id === myId ? 'comment' : null
      if (!mode) continue
      out.push({
        id: `comment:${c.id}`,
        type: 'comment',
        mode,
        workoutId: it.id,
        who: c.name ?? 'Кто-то',
        whoId: c.user_id,
        text: c.body,
        at: c.created_at,
      })
    }
  }
  return out
}

export function commentReactionNotifs(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .filter((r) => r?.comment_id && r.user_id && r.created_at && EMOJI.has(r.kind))
    .map((r) => ({
      id: `creact:${r.comment_id}:${r.user_id}`,
      type: 'comment_react',
      workoutId: String(r.workout_id),
      who: (r.author_name ?? '').trim() || 'Кто-то',
      whoId: String(r.user_id),
      emoji: EMOJI.get(r.kind),
      text: r.body ?? '',
      at: r.created_at,
    }))
}
