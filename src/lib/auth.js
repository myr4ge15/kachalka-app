// ============================================================================
// Логин-мост к Supabase Auth (PLAN-auth §1, §5).
//
// Вход больше НЕ проверяет PIN на клиенте против публичной БД. Вместо этого:
//   - онлайн: шлём { user_id, pin } в Edge Function auth-login по TLS. Она
//     сверяет PIN service-ролью, мостит к скрытой учётке Supabase Auth и
//     возвращает настоящую сессию (access+refresh) + наши pin_hash/pin_salt.
//     setSession сохраняет сессию (supabase-js сам обновляет токен);
//     pin_hash/salt кэшируем локально для офлайн-разблокировки.
//   - офлайн: сверяем PIN с локально закэшированным хэшем (verifyPinOffline) —
//     UI открывается мгновенно без сети, как только устройство хоть раз входило.
//
// pin_hash/pin_salt лежат ТОЛЬКО в своей IndexedDB (meta), не в публичной БД и
// не у других клиентов. PIN текущей сессии держим в памяти (не на диске) как
// запасной путь молчаливого перевыпуска сессии.
// ============================================================================
import { supabase } from '../db/supabase.js'
import { getMeta, setMeta } from '../db/local.js'
import { verifyPin } from './hash.js'

const FN_URL = (import.meta.env.VITE_SUPABASE_URL ?? '') + '/functions/v1/auth-login'
const ANON = import.meta.env.VITE_SUPABASE_KEY ?? ''

// Ключ локального кэша офлайн-разблокировки (свои хэш+соль+имя+роль).
const pinCacheKey = (userId) => `pin_${userId}`

// PIN текущей сессии в памяти (чистится при logout). Не на диске.
let sessionPin = null

// Ошибка входа с машиночитаемым кодом для UI.
export class LoginError extends Error {
  constructor(code, message, retryAfter = null) {
    super(message)
    this.name = 'LoginError'
    this.code = code // 'network' | 'locked' | 'invalid' | 'server'
    this.retryAfter = retryAfter
  }
}

// Онлайн-вход через auth-login. Возвращает { id, name, role }.
export async function login(userId, pin) {
  let res
  try {
    res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: ANON,
        authorization: `Bearer ${ANON}`,
      },
      body: JSON.stringify({ user_id: userId, pin }),
    })
  } catch {
    throw new LoginError('network', 'Нет сети — попробуй позже.')
  }

  let body = null
  try { body = await res.json() } catch { /* пустое/нестандартное тело */ }

  if (res.status === 429) {
    throw new LoginError('locked', 'Слишком много попыток. Подожди немного.', body?.retry_after ?? null)
  }
  if (res.status === 401) {
    throw new LoginError('invalid', 'Неверный PIN')
  }
  if (!res.ok || !body?.session) {
    throw new LoginError('server', body?.error ?? 'Не удалось войти.')
  }

  const { error } = await supabase.auth.setSession({
    access_token: body.session.access_token,
    refresh_token: body.session.refresh_token,
  })
  if (error) throw new LoginError('server', error.message)

  // Кэш офлайн-разблокировки — только свои значения текущего пользователя.
  await setMeta(pinCacheKey(userId), {
    pin_hash: body.pin_hash,
    pin_salt: body.pin_salt ?? null,
    name: body.user.name,
    role: body.user.role,
  })
  sessionPin = pin
  return { id: body.user.id, name: body.user.name, role: body.user.role }
}

// Офлайн-проверка PIN по локальному кэшу. Возвращает:
//   { id, name, role } — кэш есть и PIN верный (можно открыть UI);
//   false              — кэш есть, но PIN неверный;
//   null               — кэша нет (первый вход на устройстве → нужна сеть).
export async function verifyPinOffline(userId, pin) {
  const cached = await getMeta(pinCacheKey(userId))
  if (!cached?.pin_hash) return null
  const ok = await verifyPin(pin, { pin_hash: cached.pin_hash, pin_salt: cached.pin_salt })
  if (!ok) return false
  sessionPin = pin
  return { id: userId, name: cached.name, role: cached.role }
}

// Молчаливый перевыпуск сессии (сеть появилась, UI уже открыт офлайн).
// Использует PIN из памяти; если его нет — тихо ничего не делает.
export async function refreshSessionSilently(userId) {
  if (!sessionPin) return false
  try {
    await login(userId, sessionPin)
    return true
  } catch {
    return false
  }
}

export function getSessionPin() {
  return sessionPin
}

export async function logout() {
  sessionPin = null
  try { await supabase.auth.signOut() } catch { /* офлайн — локальная сессия и так уйдёт */ }
}
