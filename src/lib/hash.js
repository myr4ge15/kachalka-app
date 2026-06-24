// Хэширование PIN через Web Crypto (доступно на https и localhost).
//
// Схема (актуальная): PBKDF2-HMAC-SHA256(pin, salt, iterations) → 32 байта в hex,
// соль персональная (колонка users.pin_salt). Соль не секрет — она лишь не даёт
// одной радужной таблице вскрыть всех сразу и делает одинаковые PIN разными хэшами;
// PBKDF2 дополнительно замедляет перебор. 4-значный PIN всё равно мал, поэтому
// настоящая защита — рейт-лимит на сервере / Supabase Auth (см. техдолг).
//
// Legacy: старые записи без соли проверяются по простому SHA-256(pin) — вход
// существующих пользователей не ломается до перевыкатки seed.sql.

const PIN_ITERATIONS = 100000

function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

// SHA-256 хэш (legacy-схема PIN + общего назначения).
export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toHex(digest)
}

// Случайная соль в hex (по умолчанию 16 байт).
export function randomSaltHex(bytes = 16) {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return toHex(a)
}

// PBKDF2-HMAC-SHA256(pin, salt, iterations) → 32 байта в hex.
// Параметры совпадают с node: crypto.pbkdf2Sync(pin, Buffer.from(saltHex,'hex'),
// iterations, 32, 'sha256') — поэтому seed.sql (node) и клиент дают один хэш.
export async function pbkdf2Hex(pin, saltHex, iterations = PIN_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' },
    key, 256
  )
  return toHex(bits)
}

// Проверка PIN: соль есть → PBKDF2, нет → legacy SHA-256.
export async function verifyPin(pin, user) {
  if (user?.pin_salt) {
    return (await pbkdf2Hex(pin, user.pin_salt)) === user.pin_hash
  }
  return (await sha256Hex(pin)) === user.pin_hash
}
