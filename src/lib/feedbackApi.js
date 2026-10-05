// ============================================================================
// «Написать разработчику» (v6.11.0) — онлайн-операции. Как приглашения и
// админка, это исключение из очередей синка: обращение имеет смысл только
// отправленным, офлайн-очереди нет (кнопка честно говорит «нет связи»).
//
//   submit       — скриншот (по желанию) → Storage `feedback/<uid>/<uuid>.jpg`,
//                  затем Edge Function `feedback` (запись + Telegram владельцу);
//   listMine/ack — свои обращения и «ответ прочитан» (DEFINER RPC);
//   adminList/adminUpdate/shotUrl — бэклог в админке; ответ шлет пуш автору
//                  через ту же Edge Function (там VAPID-ключи).
//   reopen       — «Не помогло — открыть снова» (v6.12.0);
//   media        — картинка из Telegram (фото ответа, скриншот) через Edge:
//                  токен бота у клиента не бывает, права проверяет SQL.
// Права проверяет сервер (app_uid / is_admin); клиентскому role не верим.
// ============================================================================
import { supabase, hasSession } from '../db/supabase.js'
import { compressToJpeg } from './avatar.js'
import { DB_TIMEOUT_MS, withTimeout } from './withTimeout.js'
import { bodyProblem, cleanBody, feedbackErrorText, reopenProblem, unreadReplies } from './feedback.js'
import { cacheFeedbackReplies } from '../db/feedbackReplies.js'

const FN_URL = (import.meta.env.VITE_SUPABASE_URL ?? '') + '/functions/v1/feedback'
const ANON = import.meta.env.VITE_SUPABASE_KEY ?? ''
// Скриншот: телефонный экран после сжатия ~150–400 КБ; bucket пускает до 2 МБ.
const SHOT_MAX_PX = 1280
const SHOT_QUALITY = 0.75

export class FeedbackError extends Error {
  constructor(code) {
    super(feedbackErrorText(code))
    this.name = 'FeedbackError'
    this.code = code
  }
}

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

async function accessToken() {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token ?? null
  } catch {
    return null
  }
}

function rpcCode(error) {
  if (!error) return null
  if (error.code === 'PGRST202') return 'not_deployed'
  if (error.code === '42501' || /forbidden/.test(error.message ?? '')) return 'forbidden'
  return 'server_error'
}

async function rpc(name, args) {
  if (isOffline()) throw new FeedbackError('offline')
  const { data, error } = await withTimeout(supabase.rpc(name, args))
  if (error) throw new FeedbackError(rpcCode(error))
  return data
}

// Запрос к Edge `feedback`. read(res) читает тело, пока таймер еще идет.
async function fnFetch(body, read) {
  if (isOffline()) throw new FeedbackError('offline')
  const token = await accessToken()
  if (!token) throw new FeedbackError('no_session')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), DB_TIMEOUT_MS)
  try {
    let res
    try {
      res = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: ANON, authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
    } catch {
      throw new FeedbackError('network')
    }
    return await read(res)
  } finally {
    clearTimeout(timer)
  }
}

async function callFn(body) {
  return fnFetch(body, readJson)
}

async function readJson(res) {
  let payload = null
  try { payload = await res.json() } catch { /* нестандартное тело */ }
  if (res.status === 404 && !payload?.error) throw new FeedbackError('not_deployed')
  if (res.status === 401) throw new FeedbackError('no_session')
  if (!res.ok || !payload?.ok) throw new FeedbackError(payload?.error ?? 'server_error')
  return payload
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  // Запасной путь для старых WebView: UUID v4 из getRandomValues.
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// Отправить обращение. file — необязательный скриншот (File/Blob картинки).
// Возвращает { id, delivered } (delivered=false — записано, но Telegram не ответил).
export async function submitFeedback(userId, { body, context, file = null, compress = compressToJpeg } = {}) {
  const problem = bodyProblem(body)
  if (problem) throw new FeedbackError(problem)
  if (isOffline()) throw new FeedbackError('offline')
  if (!await hasSession(userId)) throw new FeedbackError('no_session')

  let screenshot = null
  if (file) {
    let blob
    try {
      blob = await compress(file, SHOT_MAX_PX, SHOT_QUALITY)
    } catch {
      throw new FeedbackError('shot_failed')
    }
    const path = `${userId}/${newId()}.jpg`
    const up = await withTimeout(
      supabase.storage.from('feedback').upload(path, blob, { upsert: false, contentType: 'image/jpeg' }),
    ).catch(() => ({ error: true }))
    if (up?.error) throw new FeedbackError('shot_failed')
    screenshot = path
  }

  const res = await callFn({ action: 'submit', body: cleanBody(body), context: context ?? {}, screenshot })
  return { id: res.id, delivered: res.delivered !== false }
}

export async function listMyFeedback(userId) {
  if (!await hasSession(userId)) throw new FeedbackError('no_session')
  const rows = (await rpc('my_feedback')) ?? []
  await cacheFeedbackReplies(userId, rows)
  return rows
}

// «Ответы прочитаны». Ошибка не важна: метка просто останется до следующего раза.
export async function ackMyFeedback() {
  try {
    await withTimeout(supabase.rpc('ack_my_feedback'))
  } catch { /* не критично */ }
}

// Сколько непрочитанных ответов — для метки в Настройках. Тихо 0 при любой ошибке.
export async function myUnreadReplies(userId) {
  try {
    if (isOffline() || !await hasSession(userId)) return 0
    const { data, error } = await withTimeout(supabase.rpc('my_feedback'))
    if (error) return 0
    // Заодно — ответы для «Уведомлений» (v6.12.0): эта проверка идет при входе и
    // возврате в приложение, так колокольчик узнает об ответе без захода в Профиль.
    await cacheFeedbackReplies(userId, data)
    return unreadReplies(data)
  } catch {
    return 0
  }
}

export async function adminListFeedback(openOnly = false) {
  return (await rpc('admin_list_feedback', { p_open_only: Boolean(openOnly) })) ?? []
}

// Статус + ответ. Сервер сам решает, слать ли пуш (новый ответ или финальный статус).
export async function adminUpdateFeedback(id, status, reply) {
  const text = cleanBody(reply)
  if (text.length > 2000) throw new FeedbackError('too_long')
  const res = await callFn({ action: 'update', id, status, reply: text || null })
  return { notified: Boolean(res.notified), pushed: Number(res.pushed) || 0 }
}

// Временная ссылка на скриншот (bucket приватный, читать может только админ).
// «Не помогло — открыть снова»: комментарий уходит разработчику реплаем в Telegram.
export async function reopenFeedback(id, note) {
  const problem = reopenProblem(note)
  if (problem) throw new FeedbackError(problem)
  const res = await callFn({ action: 'reopen', id, note: cleanBody(note) })
  return { delivered: res.delivered !== false }
}

// Картинка из Telegram → object URL. Кэш на сессию: повторный заход на экран не
// качает те же байты снова (file_id неизменен, картинка тоже).
const mediaCache = new Map()
export function feedbackMedia(id, kind = 'reply', n = 0) {
  const key = `${id}:${kind}:${n}`
  if (!mediaCache.has(key)) {
    const p = fnFetch({ action: 'media', id, kind, n }, async (res) => {
      if (res.status === 404) throw new FeedbackError('not_found')
      if (res.status === 401) throw new FeedbackError('no_session')
      if (!res.ok) throw new FeedbackError('server_error')
      return URL.createObjectURL(await res.blob())
    })
    // Неудачу не кэшируем — следующая попытка (появилась сеть) пойдет заново.
    p.catch(() => mediaCache.delete(key))
    mediaCache.set(key, p)
  }
  return mediaCache.get(key)
}

export function _clearMediaCache() {
  mediaCache.clear()
}

export async function feedbackShotUrl(path) {
  const { data, error } = await withTimeout(supabase.storage.from('feedback').createSignedUrl(path, 600))
  if (error || !data?.signedUrl) throw new FeedbackError('server_error')
  return data.signedUrl
}
