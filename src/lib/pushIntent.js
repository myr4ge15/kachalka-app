// Куда вести по нажатию на пуш (v6.7.2). Service worker (public/push-sw.js)
// кладет tag уведомления в параметр `push` адреса приложения — и при холодном
// старте (openWindow), и сообщением в уже открытое окно. Здесь tag превращается
// в намерение. Сервер для этого ничего не меняет: tag уже несет нужный id.
//
//   reaction-<workoutId>-<reactorId> → карточка своей тренировки.
//
// Остальные пуши (рекорды, рейтинг, напоминания) пока ведут на Главную, как раньше.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const REACTION_RE = new RegExp(`^reaction-(${UUID})-`, 'i')

export const PUSH_PARAM = 'push'

export function pushIntentFromTag(tag) {
  if (typeof tag !== 'string') return null
  const m = REACTION_RE.exec(tag)
  if (m) return { type: 'workout', workoutId: m[1].toLowerCase() }
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
