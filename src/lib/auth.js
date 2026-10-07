// ============================================================================
// Логин-мост к Supabase Auth (PLAN-auth §1, §5).
//
// Вход больше НЕ проверяет PIN на клиенте против публичной БД. Вместо этого:
//   - онлайн: шлем { user_id, pin } (или { name, pin } с нового устройства, v6.12.0) в Edge Function auth-login по TLS. Она
//     сверяет PIN service-ролью, мостит к скрытой учетке Supabase Auth и
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
import { supabase, isSessionOf, hasSession } from '../db/supabase.js'
import { getLoginMeta, setLoginMeta, listLoginMeta, deleteLoginMeta } from '../db/local.js'
import { verifyPin } from './hash.js'
import { WEAK_PIN_TEXT } from './pinPolicy.js'
import { normalizeLogin, loginProblem, loginStatusText } from './login.js'
import { DB_TIMEOUT_MS, withTimeout } from './withTimeout.js'

// fetch с жестким таймаутом через AbortController: подвисшая сеть (корпоративный
// прокси/фаервол «держит» соединение, не отклоняя его) иначе вешала вход на
// минуту+. По истечении DB_TIMEOUT_MS запрос прерывается → fetch бросает →
// вызов мапит это в LoginError('network'), а не крутит спиннер бесконечно.
async function fetchWithTimeout(url, opts, ms = DB_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

const FN_URL = (import.meta.env.VITE_SUPABASE_URL ?? '') + '/functions/v1/auth-login'
const SET_PIN_URL = (import.meta.env.VITE_SUPABASE_URL ?? '') + '/functions/v1/auth-set-pin'
const INVITE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '') + '/functions/v1/invite-redeem'
const ANON = import.meta.env.VITE_SUPABASE_KEY ?? ''
const RESET_URL = (import.meta.env.VITE_SUPABASE_URL ?? '') + '/functions/v1/pin-reset'

// Ключ локального кэша офлайн-разблокировки (свои хэш+соль+имя+роль).
// Кэш лежит в ОБЩЕЙ login-базе (loginDb.meta), а не в персональной: офлайн-
// разблокировка читает его ДО входа, когда личная база еще не открыта
// (PLAN-user-isolation). Ключ уже неймспейснут по userId.
const pinCacheKey = (userId) => `pin_${userId}`

// PIN текущей сессии в памяти (чистится при logout). Не на диске. Хранится ВМЕСТЕ
// с владельцем: на общем телефоне PIN учетки A не должен уйти на сервер в паре с
// id учетки B (лишняя неудачная попытка в счетчик блокировки B).
let sessionPin = null       // PIN
let sessionPinUserId = null // чей он
// Последний неудачный фоновый вход и чья это учетка (см. noteLoginFailure).
let lastLoginFailure = null
let lastLoginUserId = null
// «Поколение» входа: растет на logout. Ответ auth-login, пришедший ПОСЛЕ выхода
// (медленная сеть, таймаут 30 с), относится к прошлому поколению и применяться не
// должен — иначе он возвращал в хранилище сессию вышедшего и подменял PIN в памяти
// (РЕВЬЮ-КОДА-2026-10-02, п. 21).
let authGeneration = 0
// Вход, который сейчас в полете: фоновый перевыпуск не дублирует его.
let inFlight = null // { userId, promise }

function rememberPin(userId, pin) {
  sessionPin = pin
  sessionPinUserId = userId
}

// Ошибка входа с машиночитаемым кодом для UI.
export class LoginError extends Error {
  constructor(code, message, retryAfter = null) {
    super(message)
    this.name = 'LoginError'
    this.code = code // 'network' | 'locked' | 'invalid' | 'server' | 'session'
    this.retryAfter = retryAfter
  }
}

// Онлайн-вход через auth-login. Возвращает { id, name, role }.
// opts.timeoutMs — свой таймаут запроса (экран входа с офлайн-кэшем ждет сервер
// недолго и при сбое сети открывается по кэшу; по умолчанию — DB_TIMEOUT_MS).
export function login(userId, pin, opts = {}) {
  const promise = doLogin(userId, pin, opts.timeoutMs).catch((err) => {
    // Чья это неудача — знает сама ошибка (noteLoginFailure не гадает по глобалу).
    if (err && typeof err === 'object') err.userId = userId
    throw err
  })
  const mine = { userId, promise }
  inFlight = mine
  const done = () => { if (inFlight === mine) inFlight = null }
  promise.then(done, done)
  return promise
}

async function doLogin(userId, pin, timeoutMs) {
  lastLoginUserId = userId
  const generation = authGeneration
  const stale = () => generation !== authGeneration
  const body = await postLogin({ user_id: userId, pin }, timeoutMs)
  return adoptSession(body, userId, pin, stale)
}

// Вход по имени (v6.12.0) — новое устройство, учетки еще нет в пикере. Сервер
// прощает регистр, пробелы, знаки и узнает однозначное начало имени; «нет такого
// имени» и «неверный PIN» для него одно и то же (LoginError 'invalid').
// Офлайн невозможен: хэша этой учетки на устройстве еще нет.
export async function loginByName(name, pin) {
  const generation = authGeneration
  const stale = () => generation !== authGeneration
  const body = await postLogin({ name: String(name ?? '').trim(), pin })
  lastLoginUserId = body.user.id
  return adoptSession(body, body.user.id, pin, stale)
}

async function postLogin(payload, timeoutMs = DB_TIMEOUT_MS) {
  let res
  try {
    res = await fetchWithTimeout(FN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: ANON,
        authorization: `Bearer ${ANON}`,
      },
      body: JSON.stringify(payload),
    }, timeoutMs)
  } catch {
    throw new LoginError('network', 'Нет сети — попробуй позже.')
  }

  let body = null
  try { body = await res.json() } catch { /* пустое/нестандартное тело */ }

  if (res.status === 429) {
    throw new LoginError('locked', 'Слишком много попыток. Подожди немного.', body?.retry_after ?? null)
  }
  if (res.status === 401) {
    throw new LoginError('invalid', payload.name != null ? 'Логин или PIN не подходят' : 'Неверный PIN')
  }
  if (res.status === 400 && payload.name != null) {
    throw new LoginError('invalid', 'Логин или PIN не подходят')
  }
  if (!res.ok || !body?.session || !body?.user?.id) {
    throw new LoginError('server', body?.error ?? 'Не удалось войти.')
  }
  return body
}

// Ответ сервера вида { session, user, pin_hash, pin_salt } (auth-login и
// invite-redeem) → поднять сессию, закэшировать свой хэш для офлайн-входа, PIN в память.
async function adoptSession(body, userId, pin, stale) {
  // Пока ждали ответ, человек вышел (или вошел другой): сессию не поднимаем.
  if (stale()) throw new LoginError('cancelled', 'Вход отменен.')

  const { error } = await supabase.auth.setSession({
    access_token: body.session.access_token,
    refresh_token: body.session.refresh_token,
  })
  if (error) throw new LoginError('server', error.message)

  // Кэш офлайн-разблокировки — только свои значения текущего пользователя.
  await setLoginMeta(pinCacheKey(userId), {
    pin_hash: body.pin_hash,
    pin_salt: body.pin_salt ?? null,
    name: body.user.name,
    role: body.user.role,
  })
  // Вышли за те миллисекунды, что поднималась сессия: PIN в память не кладем.
  // Саму сессию здесь не гасим — SIGNED_OUT выкинул бы уже вошедшего следующего;
  // чужую сессию синк не использует (hasSession(userId)).
  if (stale()) throw new LoginError('cancelled', 'Вход отменен.')
  rememberPin(userId, pin)
  lastLoginFailure = null
  return { id: body.user.id, name: body.user.name, role: body.user.role }
}

// ----------------------- Регистрация по приглашению (v6.8.0) -----------------------
// Edge Function invite-redeem (supabase/invites.sql). Ссылку открывает человек без
// учетки, поэтому — anon-ключ, как у auth-login; защита — одноразовый токен.

async function callInvite(payload) {
  let res
  try {
    res = await fetchWithTimeout(INVITE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON, authorization: `Bearer ${ANON}` },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new LoginError('network', 'Нет сети — попробуй позже.')
  }
  let body = null
  try { body = await res.json() } catch { /* нестандартное тело */ }
  return { res, body }
}

// Жива ли ссылка: 'ok' | 'used' | 'revoked' | 'expired' | 'invalid'. Сбой — LoginError.
export async function checkInvite(token) {
  const { res, body } = await callInvite({ action: 'check', token })
  if (!res.ok || !body?.status) throw new LoginError('server', 'Не удалось проверить ссылку.')
  return body.status
}

// Свободен ли логин (П4, 07.10.2026) — пока человек заполняет форму регистрации.
// 'ok' | 'bad' | 'reserved' | 'taken' | 'limited' | 'invalid' (ссылка умерла). Только
// по живой ссылке и с лимитом на IP (login_check_claim). Сбой — LoginError.
export async function checkLoginForInvite(token, login) {
  const { res, body } = await callInvite({ action: 'check_login', token, login })
  if (!res.ok || !body?.status) throw new LoginError('server', 'Не удалось проверить логин.')
  return body.status
}

// Зарегистрироваться и сразу войти. Возвращает { id, name, role }. Ошибка —
// LoginError с code = код сервера ('login_taken', 'used', 'expired', …) или
// 'network' / 'server'; текст для экрана — inviteErrorText (lib/invite.js).
export async function registerByInvite(token, { name, pin, sex = null, login = null }) {
  const generation = authGeneration
  const stale = () => generation !== authGeneration
  const { res, body } = await callInvite({ action: 'redeem', token, name, pin, sex, login })
  if (!res.ok || !body?.session) {
    const code = body?.error ?? 'server'
    const err = new LoginError(code, code)
    if (body?.user?.id) err.userId = body.user.id
    throw err
  }
  lastLoginUserId = body.user.id
  return adoptSession(body, body.user.id, pin, stale)
}

// ----------------------- «Забыл PIN» (П1, 07.10.2026) -----------------------
// Edge pin-reset без сессии (человек как раз не может войти); SQL — pin-recovery.sql.

async function callReset(payload) {
  let res
  try {
    res = await fetchWithTimeout(RESET_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON, authorization: `Bearer ${ANON}` },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new LoginError('network', 'Нет сети — попробуй позже.')
  }
  let body = null
  try { body = await res.json() } catch { /* нестандартное тело */ }
  return { res, body }
}

// Попросить ссылку в Telegram. Ответ один и тот же, есть ли логин и привязан ли
// Telegram (по нему ничего не выяснить); 429 — LoginError('locked').
export async function requestPinReset(login) {
  const { res, body } = await callReset({ action: 'request', login: String(login ?? '').trim() })
  if (res.status === 429) throw new LoginError('locked', 'Слишком много попыток — подожди немного.', body?.retry_after ?? null)
  if (!res.ok) throw new LoginError('server', 'Не получилось — попробуй позже.')
  return true
}

// Жива ли ссылка сброса: 'ok' | 'invalid'.
export async function checkPinReset(token) {
  const { res, body } = await callReset({ action: 'check', token })
  if (!res.ok || !body?.status) throw new LoginError('server', 'Не удалось проверить ссылку.')
  return body.status
}

async function adoptReset(res, body, pin, stale) {
  if (res.status === 429) throw new LoginError('locked', 'Слишком много попыток — подожди немного.', body?.retry_after ?? null)
  if (res.status === 410) throw new LoginError('expired', 'expired')
  if (res.status === 401) throw new LoginError('invalid', 'invalid')
  if (!res.ok || !body?.session) throw new LoginError(body?.error ?? 'server', body?.error ?? 'server')
  lastLoginUserId = body.user.id
  return adoptSession(body, body.user.id, pin, stale)
}

// Новый PIN по ссылке из бота → сразу вход ({ id, name, role }).
export async function applyPinReset(token, pin) {
  const generation = authGeneration
  const stale = () => generation !== authGeneration
  const { res, body } = await callReset({ action: 'apply', token, pin })
  return adoptReset(res, body, pin, stale)
}

// Новый PIN по коду восстановления → сразу вход. Код после этого погашен.
export async function resetPinByCode(login, code, pin) {
  const generation = authGeneration
  const stale = () => generation !== authGeneration
  const { res, body } = await callReset({ action: 'code', login: String(login ?? '').trim(), code: String(code ?? '').trim(), pin })
  return adoptReset(res, body, pin, stale)
}

// Имя бота для ссылки привязки (Edge спрашивает getMe). Кэш на сессию страницы.
let botUsernameCache = null
export async function getBotUsername() {
  if (botUsernameCache) return botUsernameCache
  const { res, body } = await callReset({ action: 'bot' })
  if (!res.ok || !body?.username) throw new LoginError('server', 'Бот сейчас недоступен — попробуй позже.')
  botUsernameCache = body.username
  return botUsernameCache
}

// Свое (под своей сессией, только онлайн): статус, новый код, токен привязки, отвязка.
async function myRpc(userId, fn, args) {
  if (!navigator.onLine) throw new LoginError('network', 'Только онлайн.')
  await ensureOwnSession(userId)
  let res
  try {
    res = await withTimeout(args ? supabase.rpc(fn, args) : supabase.rpc(fn))
  } catch {
    throw new LoginError('network', 'Нет сети — попробуй позже.')
  }
  if (res.error) {
    if (/rate limited/.test(String(res.error.message ?? ''))) {
      throw new LoginError('limited', 'Слишком часто — попробуй завтра.')
    }
    throw rpcError(res.error, fn, 'Не получилось — попробуй позже.')
  }
  return res.data
}

// { hasCode, codeCreatedAt, tgLinked, tgLinkedAt }
export async function getRecoveryStatus(userId) {
  const data = await myRpc(userId, 'my_recovery_status')
  const row = Array.isArray(data) ? data[0] : data
  return {
    hasCode: Boolean(row?.has_code), codeCreatedAt: row?.code_created_at ?? null,
    tgLinked: Boolean(row?.tg_linked), tgLinkedAt: row?.tg_linked_at ?? null,
  }
}
export const createRecoveryCode = (userId) => myRpc(userId, 'create_my_recovery_code')
export const createTgLinkToken = (userId) => myRpc(userId, 'create_my_tg_link_token')
export const unlinkTg = (userId) => myRpc(userId, 'unlink_my_tg')

// Офлайн-проверка PIN по локальному кэшу. Возвращает:
//   { id, name, role } — кэш есть и PIN верный (можно открыть UI);
//   false              — кэш есть, но PIN неверный;
//   null               — кэша нет (первый вход на устройстве → нужна сеть).
export async function verifyPinOffline(userId, pin) {
  const cached = await getLoginMeta(pinCacheKey(userId))
  if (!cached?.pin_hash) return null
  const ok = await verifyPin(pin, { pin_hash: cached.pin_hash, pin_salt: cached.pin_salt })
  if (!ok) return false
  rememberPin(userId, pin)
  return { id: userId, name: cached.name, role: cached.role }
}

// Учетки, уже входившие на этом устройстве (v6.12.0): у них есть офлайн-кэш
// pin_${id} в общей loginDb. Только они показываются в пикере входа — список всех
// участников экран входа больше не запрашивает. Порядок — как в roster (если
// передан), иначе по имени. Возвращает [{ id, name, role }].
export async function knownAccounts(roster = []) {
  const entries = await listLoginMeta('pin_')
  const byId = new Map(entries.map(({ key, value }) => [key.slice(4), value ?? {}]))
  const out = []
  for (const u of roster) {
    if (!byId.has(u.id)) continue
    const c = byId.get(u.id)
    out.push({ ...u, name: u.name ?? c.name ?? '', role: c.role ?? null })
    byId.delete(u.id)
  }
  const rest = [...byId].map(([id, c]) => ({ id, name: c.name ?? '', role: c.role ?? null }))
  rest.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  return [...out, ...rest]
}

// «Забыть на этом устройстве»: убрать учетку из пикера. Стирает только офлайн-кэш
// PIN (личная база и неотправленные правки остаются — при следующем входе по имени
// учетка вернется со всем, что было). Активную сессию не трогает.
export async function forgetAccount(userId) {
  if (!userId) return
  await deleteLoginMeta(pinCacheKey(userId))
}

// Профиль из офлайн-кэша PIN (loginDb.meta pin_${id}) для восстановления сессии
// БЕЗ хранения имени/роли в localStorage (на общих телефонах они лежали открыто).
// Роль в ростер/view login_users не отдается, поэтому role берем именно отсюда.
// Возвращает { id, name, role } или null, если кэша нет (на устройстве не входили).
export async function getCachedProfile(userId) {
  if (!userId) return null
  const cached = await getLoginMeta(pinCacheKey(userId))
  if (!cached) return null
  return { id: userId, name: cached.name ?? null, role: cached.role ?? null }
}

// Смена своего PIN (PLAN-cabinet-2c §1). Требует ОНЛАЙН и валидную сессию:
// шлем { user_id, current_pin, new_pin } в Edge Function auth-set-pin с Bearer
// текущего access_token (а не anon — серверу нужен claim app_user_id для
// проверки владельца). На успех обновляем офлайн-кэш своими новыми хэш/солью,
// чтобы офлайн-разблокировка сразу принимала новый PIN. Ошибки — LoginError.
export async function setPin(userId, currentPin, newPin) {
  // Реальный токен сессии (логин-мост уже положил его через setSession).
  let accessToken = null
  try {
    const { data } = await supabase.auth.getSession()
    accessToken = data?.session?.access_token ?? null
  } catch { /* ниже обработаем как отсутствие сессии */ }
  if (!accessToken) {
    throw new LoginError('server', 'Сессия не найдена — войди заново.')
  }

  let res
  try {
    res = await fetchWithTimeout(SET_PIN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: ANON,
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ user_id: userId, current_pin: currentPin, new_pin: newPin }),
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
    // no_session/invalid_session — сессия протухла; invalid_credentials — неверный текущий PIN.
    const code = body?.error === 'invalid_credentials' ? 'invalid' : 'server'
    const msg = code === 'invalid' ? 'Неверный текущий PIN' : 'Сессия истекла — войди заново.'
    throw new LoginError(code, msg)
  }
  if (res.status === 403) {
    throw new LoginError('server', 'Нельзя сменить чужой PIN.')
  }
  if (res.status === 400 && body?.error === 'weak_pin') {
    throw new LoginError('invalid', WEAK_PIN_TEXT)
  }
  if (!res.ok || !body?.ok) {
    throw new LoginError('server', body?.error ?? 'Не удалось сменить PIN.')
  }

  // Обновляем офлайн-кэш своими новыми значениями (имя/роль сохраняем).
  const cached = (await getLoginMeta(pinCacheKey(userId))) ?? {}
  await setLoginMeta(pinCacheKey(userId), {
    ...cached,
    pin_hash: body.pin_hash,
    pin_salt: body.pin_salt ?? null,
  })
  // Сервер отозвал все прежние сессии (v6.8.0) и выдал свежую — поднимаем ее, иначе
  // текущая сессия этого устройства уже мертва и синк попросил бы войти заново.
  if (body.session?.access_token && body.session?.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: body.session.access_token,
      refresh_token: body.session.refresh_token,
    })
    if (error) throw new LoginError('session', 'PIN сменен. Войди заново с новым PIN.')
  }
  rememberPin(userId, newPin)
  return true
}

// Смена своего имени (PLAN-cabinet-2c). Требует ОНЛАЙН и валидную сессию: пишем
// users.name через SECURITY DEFINER set_my_name (скоуп app_uid() из JWT —
// клиентского UPDATE на users нет). На успех обновляем имя в офлайн-кэше
// (meta pin_${id}), чтобы экран входа офлайн показывал новое имя. Возвращает
// очищенное имя; ошибки — LoginError ('network' | 'invalid' | 'server').
export async function setName(userId, name) {
  const clean = String(name ?? '').trim()
  if (clean.length < 1 || clean.length > 30) {
    throw new LoginError('invalid', 'Имя — от 1 до 30 символов.')
  }
  if (!navigator.onLine) {
    throw new LoginError('network', 'Смена имени — только онлайн.')
  }
  await ensureOwnSession(userId)
  let res
  try {
    res = await withTimeout(supabase.rpc('set_my_name', { p_name: clean }))
  } catch (e) {
    throw new LoginError('network', 'Нет сети — попробуй позже.')
  }
  if (res.error) throw rpcError(res.error, 'set_my_name', 'Не удалось сменить имя.')
  // Обновляем имя в офлайн-кэше своего профиля (хэш/соль/роль сохраняем).
  const cached = (await getLoginMeta(pinCacheKey(userId))) ?? {}
  await setLoginMeta(pinCacheKey(userId), { ...cached, name: clean })
  return clean
}

// Свой логин для входа (П4, 07.10.2026; supabase/login-separate.sql my_login). Виден
// только владельцу. null — логина еще нет (старая учетка) → шаг «Придумай логин».
// Только онлайн под своей сессией; сбой — LoginError.
export async function getMyLogin(userId) {
  if (!navigator.onLine) throw new LoginError('network', 'Нет сети.')
  await ensureOwnSession(userId)
  let res
  try {
    res = await withTimeout(supabase.rpc('my_login'))
  } catch {
    throw new LoginError('network', 'Нет сети — попробуй позже.')
  }
  if (res.error) throw rpcError(res.error, 'my_login', 'Не удалось узнать логин.')
  return res.data ?? null
}

// Задать/сменить свой логин. Возвращает сохраненный (нормализованный) логин; отказ —
// LoginError с code = статусом сервера ('taken' | 'bad' | 'limited') и текстом для формы.
export async function setMyLogin(userId, login) {
  const clean = normalizeLogin(login)
  const problem = loginProblem(clean)
  if (problem) throw new LoginError('bad', problem)
  if (!navigator.onLine) throw new LoginError('network', 'Логин задается только онлайн.')
  await ensureOwnSession(userId)
  let res
  try {
    res = await withTimeout(supabase.rpc('set_my_login', { p_login: clean }))
  } catch {
    throw new LoginError('network', 'Нет сети — попробуй позже.')
  }
  if (res.error) throw rpcError(res.error, 'set_my_login', 'Не удалось сохранить логин.')
  if (res.data !== 'ok') throw new LoginError(String(res.data ?? 'server'), loginStatusText(res.data))
  return clean
}

// Свой пол (v6.2.0): 'm' | 'f' | null («не указывать»). Нужен рейтингу: мужской
// борд — жим, женский — ягодичный мостик. Пишем users.sex через SECURITY DEFINER
// set_my_sex (supabase/set-my-sex.sql, владелец — app_uid()); админский
// admin_set_sex остается для правки чужого. Только онлайн, как смена имени.
// Возвращает сохраненное значение; ошибки — LoginError.
export async function setSex(userId, sex) {
  const v = sex === 'm' || sex === 'f' ? sex : null
  if (!navigator.onLine) {
    throw new LoginError('network', 'Изменить пол можно только онлайн.')
  }
  await ensureOwnSession(userId)
  let res
  try {
    res = await withTimeout(supabase.rpc('set_my_sex', { p_sex: v }))
  } catch {
    throw new LoginError('network', 'Нет сети — попробуй позже.')
  }
  if (res.error) throw rpcError(res.error, 'set_my_sex', 'Не удалось сохранить.')
  return v
}

// Серверные «мои» RPC (set_my_sex, set_my_name) выполняются только под настоящей
// сессией ЭТОЙ учетки. После офлайн-входа сессии может не быть (или она чужая —
// общий телефон), и запрос уходит анонимно: сервер отвечает «permission denied for
// function …» (инцидент 30.09, у одного из друзей при выборе пола). Перед вызовом
// пробуем тихо перевыпустить сессию по PIN из памяти; не вышло — понятная ошибка.
const NO_SESSION_MSG = 'Нет связи с сервером под твоей учеткой. Выйди и зайди заново по PIN, пока есть интернет.'
// Отказ «мои» RPC ПОСЛЕ ensureOwnSession: своя сессия уже проверена, значит
// «permission denied for function» — это права на сервере (у роли authenticated нет
// EXECUTE), а не «перезайди». Раньше оба случая давали одно «выйди и зайди заново»,
// и по жалобе нельзя было понять причину (30.09, v6.3.1). Текст сервера оставляем в сообщении.
function rpcError(err, fn, fallback) {
  const m = String(err?.message ?? '')
  if (/JWT|not authenticated/i.test(m)) return new LoginError('session', NO_SESSION_MSG)
  if (err?.code === '42501' || /permission denied/i.test(m)) {
    return new LoginError('server', `Сервер не дал прав на ${fn} — напиши админу. (${m || err?.code})`)
  }
  return new LoginError('server', m || fallback)
}
export async function ensureOwnSession(userId) {
  if (await hasSession(userId)) return
  if ((await refreshSessionSilently(userId)) && (await hasSession(userId))) return
  throw new LoginError('session', sessionFailureMessage())
}

// Почему своей сессии нет (v6.3.2). Вход открывает UI по ЛОКАЛЬНОМУ кэшу PIN, а
// сессию перевыпускает в фоне — и раньше глотал ошибку фонового входа. У друга так
// месяцами не было сессии (синк висел «↑ 4», пол не менялся), а мы видели только
// «выйди и зайди заново». Запоминаем последнюю причину и показываем ее.
export function noteLoginFailure(err) {
  // Отмененный выходом вход — не причина «нет сессии» для следующей учетки.
  if (err instanceof LoginError && err.code === 'cancelled') return
  lastLoginFailure = err ?? null
  // Сервер не принял PIN, который принял локальный кэш → кэш устарел (PIN меняли на
  // другом устройстве или админ сбросил). Стираем устаревший хэш: следующий вход
  // пойдет через сервер и честно скажет «Неверный PIN» или впустит с новым.
  const failedUserId = err?.userId ?? lastLoginUserId
  if (err instanceof LoginError && err.code === 'invalid' && failedUserId) {
    // Этот PIN сервер уже отверг — не шлем его повторно фоновым перевыпуском
    // (каждая попытка идет в счетчик блокировки).
    if (sessionPinUserId === failedUserId) { sessionPin = null; sessionPinUserId = null }
    const key = pinCacheKey(failedUserId)
    getLoginMeta(key).then((c) => c && setLoginMeta(key, { ...c, pin_hash: null, pin_salt: null })).catch(() => {})
  }
}
function sessionFailureMessage() {
  const e = lastLoginFailure
  if (!(e instanceof LoginError)) return NO_SESSION_MSG
  if (e.code === 'invalid') return 'Сервер не принял PIN, с которым ты вошел — похоже, его меняли. Выйди и войди с актуальным PIN.'
  if (e.code === 'locked') return 'Сервер входа временно заблокировал попытки. Подожди немного и попробуй снова.'
  if (e.code === 'network') return 'Не достучаться до сервера входа. Проверь интернет и попробуй еще раз.'
  return `Сервер входа не выдал сессию: ${e.message}`
}

// Офлайн-анлок открывает UI учетке B, а в хранилище может остаться сессия A
// (общий телефон, выход не дождался signOut). Фоновый перевыпуск сессии B может не
// пройти, и до тех пор все сетевое шло бы под JWT A. Синк такую сессию уже не
// использует (hasSession(userId)), а здесь ее снимаем совсем — локально, без сети.
export async function dropForeignSession(userId) {
  try {
    const { data } = await supabase.auth.getSession()
    const session = data?.session
    if (session && !isSessionOf(session, userId)) {
      await withTimeout(supabase.auth.signOut({ scope: 'local' }), 3000)
    }
  } catch { /* не критично: синк все равно не пойдет под чужой сессией */ }
}

// Молчаливый перевыпуск сессии (сеть появилась, UI уже открыт офлайн).
// Использует PIN из памяти; если его нет — тихо ничего не делает.
export async function refreshSessionSilently(userId) {
  // Вход этой учетки уже идет (LoginScreen запустил его в фоне) — ждем его, а не
  // шлем второй запрос с тем же PIN.
  if (inFlight && inFlight.userId === userId) {
    try { await inFlight.promise; return true } catch { return false }
  }
  if (!sessionPin || sessionPinUserId !== userId) return false
  try {
    await login(userId, sessionPin)
    return true
  } catch (e) {
    noteLoginFailure(e)
    return false
  }
}

// Есть ли в памяти PIN этой учетки (то есть возможен тихий перевыпуск сессии).
export function canRefreshSilently(userId) {
  return Boolean(sessionPin) && sessionPinUserId === userId
}

export function getSessionPin() {
  return sessionPin
}

export async function logout() {
  sessionPin = null
  sessionPinUserId = null
  authGeneration++
  // scope:'local' — чистим ТОЛЬКО локально сохраненную сессию, без сетевого
  // вызова /logout (по умолчанию scope:'global' дергает сервер и в авиарежиме
  // висел минутами/не отвечал). Таймаут — страховка на случай зависшего I/O.
  try {
    await withTimeout(supabase.auth.signOut({ scope: 'local' }), 3000)
  } catch { /* офлайн/таймаут — sessionPin уже сброшен, App снимет user */ }
}
