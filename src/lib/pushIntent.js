// Куда вести по нажатию на пуш (v6.7.2). Service worker (public/push-sw.js)
// кладет tag уведомления в параметр `push` адреса приложения — и при холодном
// старте (openWindow), и сообщением в уже открытое окно. Здесь tag превращается
// в намерение. Сервер для этого ничего не меняет: tag уже несет нужный id.
//
//   reaction-<workoutId>-<reactorId> → Лента, прокрутка к этой тренировке
//   (v6.7.3; в v6.7.2 открывалась карточка тренировки — не прижилось).
//   feedback-<feedbackId> → экран «Написать разработчику» с ответом (v6.11.0).
//   update → «вышла новая версия» (v6.11.1): нажатие = согласие обновиться, приложение
//   применяет ждущую версию само, без плашки (components/UpdatePrompt.jsx).
//
// Остальные пуши (рекорды, рейтинг, напоминания) пока ведут на Главную, как раньше.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const REACTION_RE = new RegExp(`^reaction-(${UUID})-`, 'i')
const FEEDBACK_RE = new RegExp(`^feedback-(${UUID})$`, 'i')

export const PUSH_PARAM = 'push'
// tag пуша о новой версии — тот же, что ставит supabase/functions/push-update.
export const UPDATE_TAG = 'update'

export function pushIntentFromTag(tag) {
  if (typeof tag !== 'string') return null
  if (tag === UPDATE_TAG) return { type: 'update' }
  const m = REACTION_RE.exec(tag)
  if (m) return { type: 'reaction', workoutId: m[1].toLowerCase() }
  const f = FEEDBACK_RE.exec(tag)
  if (f) return { type: 'feedback', feedbackId: f[1].toLowerCase() }
  return null
}

// Намерение из адреса (`?push=<tag>`) или null.
export function pushIntentFromUrl(href) {
  try {
    return pushIntentFromTag(new URL(href).searchParams.get(PUSH_PARAM))
  } catch {
    return null
  }
}

// Тот же адрес без параметра `push` — чтобы F5 не открывал тренировку снова.
export function stripPushParam(href) {
  try {
    const url = new URL(href)
    if (!url.searchParams.has(PUSH_PARAM)) return null
    url.searchParams.delete(PUSH_PARAM)
    return url.pathname + url.search + url.hash
  } catch {
    return null
  }
}
