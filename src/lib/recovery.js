// Восстановление доступа без админа (П1 «Мой круг», 07.10.2026; сервер —
// supabase/pin-recovery.sql, Edge pin-reset, бот tg-bot). Чистая логика, без сети.
//
// Два пути «Забыл PIN»:
//   • Telegram: в Профиле — одноразовая ссылка t.me/<бот>?start=<токен>; «Забыл PIN» на
//     входе → бот присылает …/kachalka-app/#reset=<токен> (10 мин, один раз).
//   • Код восстановления: 16 символов Crockford Base32, показ — один раз.
// Токен сброса живет во ФРАГМЕНТЕ адреса (как приглашение): на сервер страницы он не
// уходит; App забирает его при старте и сразу стирает из адреса.

export const RESET_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export function resetFromUrl(href) {
  try {
    const hash = new URL(String(href)).hash.replace(/^#/, '')
    const t = new URLSearchParams(hash).get('reset')
    return t && RESET_TOKEN_RE.test(t) ? t : null
  } catch {
    return null
  }
}

export function stripReset(href) {
  try {
    const url = new URL(String(href))
    if (!new URLSearchParams(url.hash.replace(/^#/, '')).has('reset')) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

// Ввод кода: регистр, дефисы и пробелы не важны; O→0, I/L→1 (как на сервере).
export function normalizeRecoveryCode(v) {
  return String(v ?? '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '')
}

// Похоже ли на код (16 знаков после нормализации) — проверка формы до сети.
export function recoveryCodeLooksValid(v) {
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(normalizeRecoveryCode(v))
}

// Ссылка привязки Telegram. username — имя бота (Edge pin-reset action=bot).
export function tgStartLink(username, token) {
  const u = String(username ?? '').replace(/^@/, '')
  if (!/^[A-Za-z0-9_]{3,64}$/.test(u) || !RESET_TOKEN_RE.test(String(token ?? ''))) return null
  return `https://t.me/${u}?start=${token}`
}

// Текст ошибки сброса по коду LoginError.code.
export function resetErrorText(code) {
  switch (code) {
    case 'invalid': return 'Логин или код не подходят.'
    case 'expired': return 'Ссылка устарела или уже использована. Запроси новую на экране входа.'
    case 'locked': return 'Слишком много попыток — подожди немного.'
    case 'weak_pin': return 'Слишком простой PIN (1234, 0000…) — придумай другой.'
    case 'network': return 'Нет сети — попробуй позже.'
    case 'reset_login_failed': return 'PIN сменен, но войти сразу не вышло. Вернись к входу и войди с новым PIN.'
    default: return 'Не получилось — попробуй еще раз чуть позже.'
  }
}
