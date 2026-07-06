// Хэширование PIN через Web Crypto (доступно на https и localhost).
//
// ВХОД проверяется на сервере (Edge Function auth-login, паритетный код в
// supabase/functions/_shared/pin.ts). Здесь verifyPin остаётся для ОФЛАЙН-
// разблокировки: src/lib/auth.js сверяет PIN с локально закэшированным своим
// хэшем (meta), когда сети нет. Параметры обязаны совпадать с сервером.
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

// Сравнение двух hex-строк за постоянное время (constant-time): длину сверяем
// заранее (у PIN-хэшей она фиксирована), дальше XOR-аккумулятор по символам —
// раннего выхода на первом несовпадении нет, поэтому по таймингу нельзя
// подбирать хэш побайтово. Паритет с сервером (_shared/pin.ts#constantTimeEqual).
export function constantTimeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

// Проверка PIN: соль есть → PBKDF2, нет → legacy SHA-256. Сравнение хэшей —
// constant-time (см. выше): офлайн-анлок 4-значного PIN всё равно слабое место
// (техдолг), но латентный тайминг-сайдченел закрываем.
export async function verifyPin(pin, user) {
  if (!user?.pin_hash) return false
  const actual = user.pin_salt
    ? await pbkdf2Hex(pin, user.pin_salt)
    : await sha256Hex(pin)
  return constantTimeHexEqual(actual, user.pin_hash)
}
