// ============================================================================
// «Друзья» (этап 1, 15.10.2026; supabase/friends.sql, план docs/plans/PLAN-friends.md).
// Чистая логика (ссылка, тексты) + онлайн-операции. Как «Мой круг» (lib/friendCircles.js):
// вне очередей синка, только онлайн и под своей сессией.
//
// Личный код дружбы — 8 знаков Crockford Base32, как код круга (нормализация оттуда).
// Ссылка: …/kachalka-app/#friend=7F3Q9XWD (фрагмент на сервер страницы не уходит; App
// забирает его и сразу стирает из адреса).
// ============================================================================
import { supabase, hasSession } from '../db/supabase.js'
import { withTimeout } from './withTimeout.js'
import { normCode } from './friendCircles.js'

export { normCode, fmtCode } from './friendCircles.js'

export function friendFromUrl(href) {
  try {
    const hash = new URL(String(href)).hash.replace(/^#/, '')
    return normCode(new URLSearchParams(hash).get('friend'))
  } catch {
    return null
  }
}

export function stripFriend(href) {
  try {
    const url = new URL(String(href))
    if (!new URLSearchParams(url.hash.replace(/^#/, '')).has('friend')) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function friendUrl(code, origin, base = '/') {
  const b = base.endsWith('/') ? base : base + '/'
  return `${origin}${b}#friend=${normCode(code) ?? ''}`
}

// Текст для «Поделиться» / «Скопировать».
export function friendMessage({ name = '', code = '', url = '' } = {}) {
  const lines = [
    `${name ? `${name} зовет` : 'Зову'} тебя в друзья в журнале тренировок 💪`,
    'Открой ссылку — или в приложении: Профиль → «Друзья» → «Ввести код».',
  ]
  if (code) lines.push(`Код: ${String(code)}`)
  if (url) lines.push(url)
  return lines.join('\n')
}

// Статус принятия кода → текст.
export function codeStatusText(status) {
  switch (status) {
    case 'ok': return 'Теперь вы друзья 🎉'
    case 'already': return 'Вы уже друзья.'
    case 'self': return 'Это твой собственный код.'
    case 'limited': return 'Слишком много попыток — подожди час.'
    case 'busy': return 'Сегодня по кодам пришло слишком много людей — попробуй завтра.'
    case 'invalid': return 'Код не подходит: опечатка или его заменили новым. Попроси свежий.'
    default: return 'Не получилось — попробуй позже.'
  }
}

// Ответ на заявку (fr_request) → текст тоста.
export function requestStatusText(status) {
  switch (status) {
    case 'sent': case 'pending': return 'Заявка отправлена'
    case 'accepted': return 'Теперь вы друзья 🎉'
    case 'already': return 'Вы уже друзья'
    case 'blocked': return 'Сначала разблокируй — в «Друзьях»'
    case 'limited': return 'Слишком много заявок — попробуй завтра'
    case 'unavailable': return 'Позвать можно только того, кого видишь в Ленте или круге'
    default: return 'Не получилось — попробуй позже'
  }
}

// fr_list → разложить по группам; состояние пары для профиля участника.
export function groupFriends(rows) {
  const g = { friend: [], incoming: [], outgoing: [], blocked: [] }
  for (const r of Array.isArray(rows) ? rows : []) if (g[r?.state]) g[r.state].push(r)
  return g
}

export function pairState(rows, memberId) {
  return (Array.isArray(rows) ? rows : []).find((r) => r?.user_id === memberId)?.state ?? 'none'
}

export class FriendError extends Error {}

function humanError(error) {
  const m = String(error?.message ?? '')
  if (error?.code === '42501' || m.includes('forbidden')) return 'Войди в свою учетную запись с интернетом.'
  if (m.includes('rate limited')) return 'Слишком часто — попробуй завтра.'
  if (error?.code === 'PGRST202') return '«Друзья» пока недоступны. Попробуй позже.'
  if (error?.code === 'PGRST301' || /jwt expired/i.test(m)) return 'Сессия устарела — закрой и снова открой приложение.'
  // Сервер ответил ошибкой (не сеть): код — в текст, по скриншоту видно причину (обращение fb_c64a8a8f).
  return 'Не получилось — попробуй еще раз.' + (error?.code ? ` (${error.code})` : '')
}

async function rpc(userId, name, args) {
  if (!navigator.onLine) throw new FriendError('Нужен интернет.')
  if (!await hasSession(userId)) throw new FriendError('Войди в свою учетную запись с интернетом.')
  let res
  try {
    res = await withTimeout(args ? supabase.rpc(name, args) : supabase.rpc(name))
  } catch {
    throw new FriendError('Нет сети — попробуй позже.')
  }
  if (res.error) throw new FriendError(humanError(res.error))
  return res.data
}

const first = (d) => (Array.isArray(d) ? d[0] : d)

export function friendsApi(userId) {
  return {
    async list() { return (await rpc(userId, 'fr_list')) ?? [] },
    async myCode(rotate = false) { return first(await rpc(userId, 'fr_my_code', { p_rotate: rotate })) },
    async preview(code) {
      const n = normCode(code)
      if (!n) return { status: 'invalid' }
      return first(await rpc(userId, 'fr_preview', { p_code: n })) ?? { status: 'invalid' }
    },
    async acceptCode(code) {
      const n = normCode(code)
      if (!n) return { status: 'invalid' }
      return first(await rpc(userId, 'fr_accept_code', { p_code: n })) ?? { status: 'invalid' }
    },
    request: (user) => rpc(userId, 'fr_request', { p_user: user }),
    respond: (user, accept) => rpc(userId, 'fr_respond', { p_user: user, p_accept: Boolean(accept) }),
    cancel: (user) => rpc(userId, 'fr_cancel', { p_user: user }),
    remove: (user) => rpc(userId, 'fr_remove', { p_user: user }),
    block: (user) => rpc(userId, 'fr_block', { p_user: user }),
    unblock: (user) => rpc(userId, 'fr_unblock', { p_user: user }),
  }
}
