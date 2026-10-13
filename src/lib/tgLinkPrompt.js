// Лист «Привяжи Telegram» при запуске (v7.5.0). Чистая логика, без сети и React.
//
// Сброс PIN переехал в отдельного бота (kachalka_pin_bot, supabase/tg-bots-split.sql):
// новый бот не может написать человеку, пока тот сам не нажал Start, поэтому
//   • привязан к старому боту (tg_bot = 'notifier') → «перепривяжи», при КАЖДОМ запуске,
//     пока не перепривяжет;
//   • не привязан вовсе → «привяжи»; «Позже» прячет лист на 3 дня.
// Лист показываем, только когда у сброса уже свой бот (pin-reset action=bot отдает
// dedicated) — иначе привязка снова ушла бы в старого бота. Сервер без tg-bots-split.sql
// (tg_bot не пришел) — про перепривязку молчим: не знаем, к какому боту привязан.

export const LATER_DELAY_MS = 3000
export const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000

export const snoozeKey = (userId) => `gym_app_tg_prompt_snooze_${userId}`

// status — getRecoveryStatus (tgLinked, tgBot); bot — { dedicated }.
// → 'relink' | 'link' | null
export function tgPromptKind(status, bot) {
  if (!status || !bot?.dedicated) return null
  if (!status.tgLinked) return 'link'
  return status.tgBot === 'notifier' ? 'relink' : null
}

// Показывать ли сейчас. snoozedUntil — число мс из localStorage (или мусор).
export function shouldShowTgPrompt(kind, snoozedUntil, now = Date.now()) {
  if (kind === 'relink') return true
  if (kind !== 'link') return false
  const until = Number(snoozedUntil)
  return !Number.isFinite(until) || now >= until
}

// Привязка удалась: в новом боте (или хотя бы есть, если сервер о боте не сообщает).
export const tgLinkDone = (status) => Boolean(status?.tgLinked) && status.tgBot !== 'notifier'

// Подпись «Позже» с обратным отсчетом: 3000 мс → «Позже (3)», 0 → «Позже».
export function laterLabel(leftMs) {
  const s = Math.ceil(Math.max(0, Number(leftMs) || 0) / 1000)
  return s > 0 ? `Позже (${s})` : 'Позже'
}
