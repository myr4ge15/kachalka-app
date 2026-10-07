// Логин для входа (П4 «Мой круг», 07.10.2026; сервер — supabase/login-separate.sql).
//
// Логин — латиница [a-z0-9_.], 3–20 символов, с буквы, без учета регистра (хранится
// в нижнем). Нужен ТОЛЬКО для входа: никому не показывается — ни в Ленте, ни в
// рейтинге. Имя (как тебя видят друзья) — отдельно, любое, не уникальное.
//
// Окончательно формат, резерв и занятость решает сервер (login_check); здесь —
// чтобы сказать сразу, без похода в сеть. Список резерва = серверному (тест сверяет
// с текстом SQL). Модуль чистый: без React, Dexie и сети.

export const LOGIN_RE = /^[a-z][a-z0-9_.]{2,19}$/

// Тот же список — в supabase/login-separate.sql (login_check).
export const RESERVED_LOGINS = [
  'admin', 'administrator', 'root', 'support', 'help', 'kachalka', 'system',
  'moderator', 'mod', 'owner', 'bot', 'telegram', 'info', 'api', 'null',
  'undefined', 'me', 'team', 'staff', 'official', 'security', 'service',
]

export function normalizeLogin(value) {
  return String(value ?? '').trim().toLowerCase()
}

// Что не так с логином (текст для формы) или '' — все в порядке.
export function loginProblem(value) {
  const v = normalizeLogin(value)
  if (!v) return 'Придумай логин.'
  if (/[а-яё]/i.test(v)) return 'Логин — латиницей: буквы a–z, цифры, точка и _.'
  if (!/^[a-z]/.test(v)) return 'Логин начинается с латинской буквы.'
  if (v.length < 3) return 'Логин — от 3 символов.'
  if (v.length > 20) return 'Логин — до 20 символов.'
  if (!LOGIN_RE.test(v)) return 'В логине только буквы a–z, цифры, точка и _.'
  if (RESERVED_LOGINS.includes(v)) return 'Этот логин занят — придумай другой.'
  return ''
}

// Ответ сервера (set_my_login / check_login) → текст для человека.
export function loginStatusText(status) {
  switch (status) {
    case 'ok': return ''
    case 'taken':
    case 'reserved':
    case 'login_taken': return 'Этот логин занят — придумай другой.'
    case 'bad':
    case 'bad_login': return 'В логине только буквы a–z, цифры, точка и _ (от 3 до 20, с буквы).'
    case 'limited': return 'Слишком много попыток — подожди немного.'
    default: return 'Не получилось проверить логин — попробуй еще раз.'
  }
}
