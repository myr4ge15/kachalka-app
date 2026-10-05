// ============================================================================
// Ответы разработчика для «Уведомлений» (v6.12.0). Обращения живут только на
// сервере (онлайн, без очередей синка), а список уведомлений строится из
// локальной базы — поэтому кладем в персональный meta КЭШ ответов из
// my_feedback. Это снимок серверных данных, а не пользовательская сущность:
// в user_meta не синкается, на другом устройстве соберется заново при первой
// же проверке (вход / возврат в приложение / экран обращений).
// ============================================================================
import { db, getMeta, setMeta } from './local.js'
import { feedbackReplyNotifs } from '../lib/feedback.js'

export const fbRepliesKey = (userId) => `fb_replies_${userId}`

// Запомнить ответы из свежего my_feedback. Тихо: кэш — не повод ронять запрос.
export async function cacheFeedbackReplies(userId, rows) {
  const d = db
  if (!d || !userId || !Array.isArray(rows)) return
  // Пока шел запрос, могли войти под другой учеткой — в чужую базу не пишем.
  if (d.name && d.name !== `gym_app_${userId}`) return
  try {
    await setMeta(fbRepliesKey(userId), feedbackReplyNotifs(rows), d)
  } catch { /* база закрыта (выход из учетки) — пропускаем */ }
}

export async function getCachedFeedbackReplies(userId) {
  const v = await getMeta(fbRepliesKey(userId))
  return Array.isArray(v) ? v : []
}
