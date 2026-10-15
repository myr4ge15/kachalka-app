// Куда вести по нажатию на пуш (v6.7.2). Service worker (public/push-sw.js)
// кладет tag уведомления в параметр `push` адреса приложения — и при холодном
// старте (openWindow), и сообщением в уже открытое окно. Здесь tag превращается
// в намерение. Сервер для этого ничего не меняет: tag уже несет нужный id.
//
//   reaction-<workoutId>-<reactorId> → Лента, прокрутка к этой тренировке
//   (v6.7.3; в v6.7.2 открывалась карточка тренировки — не прижилось).
//   feedback-<feedbackId> → экран «Написать разработчику» с ответом (v6.11.0).
//   friend → заявка в друзья / новый друг («Друзья», 15.10.2026) — экран «Друзья».
//   rest → «Отдых закончился» (v8.8.0, таймер отдыха) — к новой тренировке (композер).
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
// tag пуша таймера отдыха — тот же, что ставит supabase/functions/push-rest.
export const REST_TAG = 'rest'
// tag пушей «Друзей» — тот же, что ставит supabase/functions/push-friend.
export const FRIEND_TAG = 'friend'

export function pushIntentFromTag(tag) {
  if (typeof tag !== 'string') return null
  if (tag === UPDATE_TAG) return { type: 'update' }
  if (tag === REST_TAG) return { type: 'rest' }
  if (tag === FRIEND_TAG) return { type: 'friend' }
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

// Нажатие, которое не дошло сообщением (v8.9.2): service worker кладет адрес в Cache
// Storage (public/push-sw.js rememberIntent), приложение забирает его при открытии и
// возврате на экран. Запись одноразовая и живет PENDING_TTL_MS — старое нажатие не
// уводит с экрана через час. Нет записи / нет Cache API — null.
export const PUSH_INTENT_CACHE = 'push-intent'
export const PUSH_INTENT_KEY = '/__push-intent'
export const PENDING_TTL_MS = 2 * 60 * 1000

export async function takePendingPushUrl(now = Date.now(), store = globalThis.caches) {
  if (!store) return null
  try {
    const c = await store.open(PUSH_INTENT_CACHE)
    const res = await c.match(PUSH_INTENT_KEY)
    if (!res) return null
    await c.delete(PUSH_INTENT_KEY)
    const { url, at } = await res.json()
    return typeof url === 'string' && Number.isFinite(at) && now - at >= 0 && now - at <= PENDING_TTL_MS ? url : null
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
