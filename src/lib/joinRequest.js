// ============================================================================
// Заявка «Хочу в круг» с экрана входа (v6.12.0). Edge `join-request`
// (supabase/functions/join-request, SQL — login-join.sql).
//
// Устройство придумывает себе секрет (32 случайных байта) и шлет его вместе с
// заявкой; сервер хранит только SHA-256. Ожидающая заявка лежит в localStorage
// (до входа личной базы нет), и при каждом открытии экрана входа устройство
// спрашивает статус; пока экран открыт — переспрашивает само (joinPollDelay). Одобрено → сервер ОДИН раз отдает токен приглашения, и
// экран входа открывает обычную регистрацию (#invite=…).
// ============================================================================
import { DB_TIMEOUT_MS } from './withTimeout.js'

const URL_ = (import.meta.env.VITE_SUPABASE_URL ?? '') + '/functions/v1/join-request'
const ANON = import.meta.env.VITE_SUPABASE_KEY ?? ''
export const JOIN_KEY = 'gym_app_join_request'
export const NAME_MAX = 40
export const ABOUT_MAX = 300

export class JoinError extends Error {
  constructor(code) {
    super(code)
    this.name = 'JoinError'
    this.code = code // 'network' | 'rate_limited' | 'bad_request' | 'server'
  }
}

export function joinErrorText(code) {
  if (code === 'network') return 'Нет связи с сервером — попробуй позже.'
  if (code === 'rate_limited') return 'Заявок сейчас слишком много. Попробуй завтра.'
  if (code === 'bad_request') return 'Проверь имя (до 40 символов) и текст (до 300).'
  return 'Не получилось отправить. Попробуй еще раз.'
}

// Проверка формы до отправки: текст ошибки или null.
export function validateJoin({ name, about }) {
  const n = String(name ?? '').trim()
  if (!n) return 'Напиши, как тебя зовут.'
  if (n.length > NAME_MAX) return `Имя — до ${NAME_MAX} символов.`
  if (String(about ?? '').trim().length > ABOUT_MAX) return `Пара слов — до ${ABOUT_MAX} символов.`
  return null
}

export function randomSecret() {
  const a = new Uint8Array(32)
  crypto.getRandomValues(a)
  let s = ''
  for (const b of a) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// --- откуда пришел человек (v6.15.3) ---
// Метка в ссылке анонса: …/kachalka-app/?src=tg (Telegram), ?src=ig (Instagram) и т.п.
// При открытии запоминаем ее на устройстве и убираем из адреса; с заявкой она уходит
// владельцу строкой «Откуда: …» в Telegram. Без метки — «напрямую». Только латиница,
// цифры, _ и -, до 20 символов: это подпись, а не данные.
export const SOURCE_KEY = 'gym_app_src'
export const SOURCE_PARAM = 'src'
const SOURCE_RE = /^[a-z0-9_-]{1,20}$/

export function normSource(v) {
  const s = String(v ?? '').trim().toLowerCase()
  return SOURCE_RE.test(s) ? s : null
}

// Запомнить метку из адреса. Возвращает адрес без нее (для history.replaceState)
// или null, если метки не было. Последняя метка побеждает: важнее, откуда пришли сейчас.
export function captureSource(href, storage = globalThis.localStorage) {
  try {
    const url = new URL(href)
    if (!url.searchParams.has(SOURCE_PARAM)) return null
    const src = normSource(url.searchParams.get(SOURCE_PARAM))
    if (src) { try { storage?.setItem(SOURCE_KEY, src) } catch { /* приватный режим */ } }
    url.searchParams.delete(SOURCE_PARAM)
    return url.pathname + url.search + url.hash
  } catch {
    return null
  }
}

export function loadSource(storage = globalThis.localStorage) {
  try { return normSource(storage?.getItem(SOURCE_KEY)) } catch { return null }
}

// --- локальная заявка (localStorage может быть недоступен — тогда просто нет) ---
export function loadPending(storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage?.getItem(JOIN_KEY) ?? 'null')
    return v && typeof v.id === 'string' && typeof v.secret === 'string' ? v : null
  } catch { return null }
}
export function savePending(p, storage = globalThis.localStorage) {
  try { storage?.setItem(JOIN_KEY, JSON.stringify(p)) } catch { /* приватный режим */ }
}
export function clearPending(storage = globalThis.localStorage) {
  try { storage?.removeItem(JOIN_KEY) } catch { /* приватный режим */ }
}

async function call(payload, fetchImpl = fetch) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), DB_TIMEOUT_MS)
  let res
  try {
    res = await fetchImpl(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON, authorization: `Bearer ${ANON}` },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
  } catch {
    throw new JoinError('network')
  } finally {
    clearTimeout(t)
  }
  let body = null
  try { body = await res.json() } catch { /* нестандартное тело */ }
  if (res.status === 429) throw new JoinError('rate_limited')
  if (res.status === 400) throw new JoinError('bad_request')
  if (!res.ok) throw new JoinError('server')
  return body ?? {}
}

// Отправить заявку. website — скрытое поле-ловушка формы (у человека пустое).
// Возвращает сохраненную заявку { id, secret, name, at }.
export async function submitJoin({ name, about, website = '' }, { fetchImpl, storage, now = Date.now } = {}) {
  const secret = randomSecret()
  const source = loadSource(storage) // откуда пришел (метка ?src= из ссылки анонса), null — напрямую
  const body = await call({ action: 'submit', name: String(name).trim(), about: String(about ?? '').trim(), website, secret, source }, fetchImpl)
  if (typeof body.id !== 'string') throw new JoinError('server')
  const pending = { id: body.id, secret, name: String(name).trim(), at: now() }
  savePending(pending, storage)
  return pending
}

// Как часто экран входа сам переспрашивает заявку, пока она ждет ответа (v6.14.3):
// владелец обычно отвечает за минуту-другую — первые 2 минуты каждые 5 с, до 10 минут
// каждые 15 с, дальше раз в минуту. elapsedMs — сколько экран уже ждет.
export function joinPollDelay(elapsedMs) {
  if (elapsedMs < 2 * 60_000) return 5_000
  if (elapsedMs < 10 * 60_000) return 15_000
  return 60_000
}

// Статус заявки: { status, token? }. Одобрено (token есть) или окончательный
// ответ (declined / claimed без токена / invalid) — локальная заявка стирается
// вызывающим, когда он ее показал.
export async function pollJoin(pending, { fetchImpl } = {}) {
  const body = await call({ action: 'poll', id: pending.id, secret: pending.secret }, fetchImpl)
  const status = typeof body.status === 'string' ? body.status : 'invalid'
  return typeof body.token === 'string' ? { status, token: body.token } : { status }
}
