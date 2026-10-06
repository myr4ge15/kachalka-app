// ============================================================================
// Ссылка-приглашение (v6.8.0, supabase/invites.sql) — чистая логика без сети.
//
// Токен живет во ФРАГМЕНТЕ адреса: https://…/kachalka-app/#invite=<токен>.
// Фрагмент не уходит на сервер (GitHub Pages его не видит, в логах и Referer его
// нет), а приложению не нужен роутер: App читает его при старте и сразу стирает.
// ============================================================================

import { isWeakPin, WEAK_PIN_TEXT } from './pinPolicy.js'

export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

// Токен из адреса или null.
export function inviteFromUrl(href) {
  try {
    const hash = new URL(String(href)).hash.replace(/^#/, '')
    const token = new URLSearchParams(hash).get('invite')
    return token && INVITE_TOKEN_RE.test(token) ? token : null
  } catch {
    return null
  }
}

// Адрес без фрагмента-приглашения или null, если стирать нечего.
export function stripInvite(href) {
  try {
    const url = new URL(String(href))
    if (!new URLSearchParams(url.hash.replace(/^#/, '')).has('invite')) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

// Ссылка для отправки человеку. base — import.meta.env.BASE_URL ('/kachalka-app/').
export function inviteUrl(token, origin, base = '/') {
  const b = base.endsWith('/') ? base : base + '/'
  return `${origin}${b}#invite=${token}`
}

// Пригласительный текст к ссылке — для «Скопировать» и «Поделиться» (оба — с url:
// ссылка последней строкой, мессенджер развернет ее в превью). Отдельным полем url
// в navigator.share ее не передаем — многие приложения тогда теряют текст.
export function inviteMessage({ url = '', expiresAt = null } = {}) {
  const lines = [
    'Привет! Зову тебя в наш журнал тренировок 💪',
    'Открой ссылку, придумай имя и PIN из 4 цифр — и ты в деле.',
  ]
  const until = expiresAt ? new Date(expiresAt) : null
  lines.push(until && !Number.isNaN(until.getTime())
    ? `Ссылка одноразовая, работает до ${String(until.getDate()).padStart(2, '0')}.${String(until.getMonth() + 1).padStart(2, '0')}.`
    : 'Ссылка одноразовая и работает 7 дней.')
  if (url) lines.push(url)
  return lines.join('\n')
}

// Проверка формы до запроса. Пустая строка — все в порядке.
export function validateRegistration({ name, pin, pin2 }) {
  const n = String(name ?? '').trim()
  if (n.length < 1) return 'Напиши, как тебя зовут.'
  if (n.length > 40) return 'Имя — до 40 символов.'
  if (!/^\d{4}$/.test(String(pin ?? ''))) return 'PIN — ровно 4 цифры.'
  if (isWeakPin(pin)) return WEAK_PIN_TEXT
  // Повтор еще не набран — просим набрать, а не пугаем «не совпадают» (v6.15.4).
  if (!String(pin2 ?? '')) return 'Введи PIN еще раз.'
  if (pin !== pin2) return 'PIN-коды не совпадают.'
  return ''
}

// Почему ссылка не работает — для экрана приглашения.
export function inviteDeadText(status) {
  switch (status) {
    case 'used': return 'По этой ссылке уже зарегистрировались. Она одноразовая — попроси новую у того, кто тебя пригласил.'
    case 'expired': return 'Срок ссылки истек. Попроси новую у того, кто тебя пригласил.'
    case 'revoked': return 'Эту ссылку отозвали. Попроси новое приглашение.'
    default: return 'Ссылка недействительна. Проверь, что скопировал ее целиком, или попроси новую.'
  }
}

export const DEAD_STATUSES = new Set(['used', 'expired', 'revoked', 'invalid'])

// Текст ошибки регистрации по коду LoginError.code.
export function inviteErrorText(code) {
  if (DEAD_STATUSES.has(code)) return inviteDeadText(code)
  switch (code) {
    case 'name_taken': return 'Это имя уже занято — добавь фамилию или инициал.'
    case 'bad_name': return 'Имя — от 1 до 40 символов.'
    case 'bad_pin': return 'PIN — ровно 4 цифры.'
    case 'weak_pin': return WEAK_PIN_TEXT
    case 'network': return 'Нет сети — попробуй позже.'
    case 'registered_login_failed': return 'Учетка создана, но войти сразу не получилось. Вернись к входу и войди по своему PIN.'
    default: return 'Не получилось зарегистрироваться. Попробуй еще раз чуть позже.'
  }
}

// Строка статуса в списке приглашений админки.
// Кто и когда создал ссылку (admin_list_invites → created_by_name, created_at).
// Создатель мог быть удален (FK on delete set null) — тогда имя неизвестно.
export function inviteCreatorLabel(inv) {
  if (!inv) return ''
  const who = inv.created_by_name ?? 'удаленный участник'
  if (!inv.created_at) return `Создал: ${who}`
  const x = new Date(inv.created_at)
  const dd = `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}`
  return `Создал: ${who} · ${dd}`
}

export function inviteListLabel(inv, now = new Date()) {
  const d = (iso) => {
    const x = new Date(iso)
    return `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}`
  }
  switch (inv?.status) {
    case 'used': return `✅ ${inv.used_by_name ?? 'участник удален'} · ${d(inv.used_at)}`
    case 'revoked': return '⛔ отозвана'
    case 'expired': return '⌛ истекла'
    case 'ok': {
      const days = Math.max(0, Math.ceil((new Date(inv.expires_at) - now) / 86400000))
      return `⏳ ждет · еще ${days} дн.`
    }
    default: return inv?.status ?? ''
  }
}
