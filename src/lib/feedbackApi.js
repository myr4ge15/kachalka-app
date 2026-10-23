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
//   append       — дописать к своему открытому обращению (v8.6.0); дополнения
//                  приходят в список отдельным RPC my_feedback_additions;
//   media        — картинка из Telegram (фото ответа, скриншот) через Edge:
//                  токен бота у клиента не бывает, права проверяет SQL.
// Права проверяет сервер (app_uid / is_admin); клиентскому role не верим.
// ============================================================================
import { supabase, hasSession } from '../db/supabase.js'
import { compressToJpeg } from './avatar.js'
import { DB_TIMEOUT_MS, withTimeout } from './withTimeout.js'
import {
  FEEDBACK_SHOTS_MAX, appendProblem, attachmentProblem, bodyProblem, cleanBody, feedbackErrorText, reopenProblem,
  clearVideoMedia, isVideoFile, markVideoMedia, sniffMediaType, unreadReplies, videoExt,
} from './feedback.js'
import { cacheFeedbackReplies } from '../db/feedbackReplies.js'

const FN_URL = (import.meta.env.VITE_SUPABASE_URL ?? '') + '/functions/v1/feedback'
const ANON = import.meta.env.VITE_SUPABASE_KEY ?? ''
const STORAGE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '') + '/storage/v1/object/feedback/'
// Видео без новых байт дольше этого — обрыв (19.10, fb_5ef64577). Раньше был жесткий предел в минуту на
// весь файл: 12 МБ на слабом LTE не успевали, хотя загрузка шла.
export const UPLOAD_STALL_MS = 30000
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
// onProgress({ loaded, total }) — байты вложений (видео — по мере отправки, картинка — целиком по готовности).
// Возвращает { id, delivered } (delivered=false — записано, но Telegram не ответил).
// paths (20.10.2026) — вложения, уже загруженные uploadAttachment (предзагрузка в форме): тогда здесь
// только текст и пути, без загрузки.
export async function submitFeedback(userId, {
  body, context, file = null, files = null, paths = null, compress = compressToJpeg, onProgress = null, uploadVideo = videoUpload,
} = {}) {
  const problem = bodyProblem(body)
  if (problem) throw new FeedbackError(problem)
  if (isOffline()) throw new FeedbackError('offline')
  if (!await hasSession(userId)) throw new FeedbackError('no_session')

  const many = Boolean(files || paths)
  const shots = paths ?? await uploadScreenshots(userId, files ?? (file ? [file] : []), { compress, onProgress, uploadVideo })
  const res = await callFn({ action: many ? 'submit_screenshots' : 'submit', body: cleanBody(body), context: context ?? {},
    ...(many ? { screenshots: shots } : { screenshot: shots[0] ?? null }) })
  return { id: res.id, delivered: res.delivered !== false }
}

export async function listMyFeedback(userId) {
  if (!await hasSession(userId)) throw new FeedbackError('no_session')
  const rows = (await rpc('my_feedback')) ?? []
  await cacheFeedbackReplies(userId, rows)
  return withScreenshotCounts(await withAdditions(rows))
}

// Дополнения (v8.6.0) — к строкам списка полем additions: [{ n, body, created_at }].
// Отдельный RPC, чтобы не менять контракт my_feedback / admin_list_feedback. Нет его на сервере или
// сбой — список без дополнений: это не повод не показать обращения.
async function withAdditions(rows, fn = 'my_feedback_additions') {
  if (!rows.length) return rows
  let adds = []
  try {
    const { data, error } = await withTimeout(supabase.rpc(fn))
    if (!error && Array.isArray(data)) adds = data.filter((a) => a?.feedback_id)
  } catch { /* без дополнений */ }
  if (!adds.length) return rows
  const by = new Map()
  for (const a of adds) {
    if (!by.has(a.feedback_id)) by.set(a.feedback_id, [])
    by.get(a.feedback_id).push({ n: a.n, body: a.body, created_at: a.created_at })
  }
  return rows.map((r) => (by.has(r.id) ? { ...r, additions: by.get(r.id).sort((x, y) => x.n - y.n) } : r))
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

// Дополнения автора — отдельным admin_feedback_additions (19.10.2026, fb_5b764337: админ их не видел).
export async function adminListFeedback(openOnly = false) {
  const rows = (await rpc('admin_list_feedback', { p_open_only: Boolean(openOnly) })) ?? []
  return withScreenshotCounts(await withAdditions(rows, 'admin_feedback_additions'))
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

// Дописать к своему открытому обращению (v8.6.0): уйдет разработчику реплаем на
// исходное сообщение в Telegram, статус не меняется.
export async function appendFeedback(id, note) {
  const problem = appendProblem(note)
  if (problem) throw new FeedbackError(problem)
  const res = await callFn({ action: 'append', id, note: cleanBody(note) })
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
      // Тип — по байтам (Edge шлет octet-stream): видео без типа iPhone не проиграет.
      const buf = await res.arrayBuffer()
      const type = sniffMediaType(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)))
      const url = URL.createObjectURL(new Blob([buf], type ? { type } : undefined))
      if (type?.startsWith('video/')) markVideoMedia(url)
      return url
    })
    // Неудачу не кэшируем — следующая попытка (появилась сеть) пойдет заново.
    p.catch(() => mediaCache.delete(key))
    mediaCache.set(key, p)
  }
  return mediaCache.get(key)
}

export function _clearMediaCache() {
  mediaCache.clear()
  clearVideoMedia()
}

export async function feedbackShotUrl(path) {
  const { data, error } = await withTimeout(supabase.storage.from('feedback').createSignedUrl(path, 600))
  if (error || !data?.signedUrl) throw new FeedbackError('server_error')
  return data.signedUrl
}

// Видео в Storage через XHR (19.10, fb_5ef64577): у supabase-js нет прогресса отправки, а видео 10–20 МБ на
// слабой связи шло дольше любого разумного общего предела. Здесь — onBytes(отправлено) и обрыв только при
// простое UPLOAD_STALL_MS. Права те же: JWT вызывающего, политика бакета пускает только в свою папку.
function xhrUpload(path, blob, contentType, onBytes) {
  return accessToken().then((token) => new Promise((resolve, reject) => {
    if (!token) { reject(new FeedbackError('no_session')); return }
    const xhr = new XMLHttpRequest()
    let stall = 0
    const fail = (code) => { clearTimeout(stall); reject(new FeedbackError(code)) }
    const arm = () => { clearTimeout(stall); stall = setTimeout(() => { xhr.abort(); fail('upload_stalled') }, UPLOAD_STALL_MS) }
    xhr.open('POST', STORAGE_URL + path)
    xhr.setRequestHeader('authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', ANON)
    xhr.setRequestHeader('content-type', contentType)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (e) => { arm(); onBytes?.(e.loaded) }
    xhr.onload = () => {
      clearTimeout(stall)
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else fail(xhr.status === 413 ? 'video_too_big' : 'video_failed')
    }
    xhr.onerror = () => fail('network')
    arm()
    xhr.send(blob)
  }))
}

// Докачка больших видео (23.10.2026, баг владельца: «медиа начинает грузиться заново посреди процесса»).
// Одним запросом любой обрыв — свернул приложение, iOS скрыла страницу на время выбора еще одного файла,
// 30 с без прогресса на слабом LTE — начинал видео с нуля. Протокол докачки Supabase Storage (TUS 1.0.0):
// создаем загрузку, шлем куски по 6 МБ (так требует Storage), после обрыва спрашиваем у сервера, сколько
// дошло (HEAD → Upload-Offset), и продолжаем с этого места; свернутое приложение ждет возврата. Сдаемся
// после TUS_MAX_FAILS обрывов подряд. request — HTTP-запрос (тест подменяет); остальное — как у xhrUpload.
export const TUS_CHUNK = 6 * 1024 * 1024
const TUS_MAX_FAILS = 6
const TUS_URL = (import.meta.env.VITE_SUPABASE_URL ?? '') + '/storage/v1/upload/resumable'
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(String(s))))
const pageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
function untilVisible() {
  if (!pageHidden()) return Promise.resolve()
  return new Promise((resolve) => {
    const on = () => { if (!pageHidden()) { document.removeEventListener('visibilitychange', on); resolve() } }
    document.addEventListener('visibilitychange', on)
  })
}

// Один HTTP-запрос через XHR: { status, header(name) } или FeedbackError('network' | 'upload_stalled').
function xhrRequest(method, url, { headers = {}, body = null, onProgress = null } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let stall = 0
    const fail = (code) => { clearTimeout(stall); reject(new FeedbackError(code)) }
    const arm = () => { clearTimeout(stall); stall = setTimeout(() => { xhr.abort(); fail('upload_stalled') }, UPLOAD_STALL_MS) }
    xhr.open(method, url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    if (xhr.upload) xhr.upload.onprogress = (e) => { arm(); onProgress?.(e.loaded) }
    xhr.onload = () => { clearTimeout(stall); resolve({ status: xhr.status, header: (n) => xhr.getResponseHeader?.(n) ?? null }) }
    xhr.onerror = () => fail('network')
    arm()
    xhr.send(body)
  })
}

export async function resumableUpload(path, blob, contentType, onBytes, { request = xhrRequest, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const auth = async () => {
    const token = await accessToken()
    if (!token) throw new FeedbackError('no_session')
    return { authorization: `Bearer ${token}`, apikey: ANON, 'Tus-Resumable': '1.0.0' }
  }
  const created = await request('POST', TUS_URL, { headers: {
    ...(await auth()), 'x-upsert': 'false', 'Upload-Length': String(blob.size),
    'Upload-Metadata': `bucketName ${b64('feedback')},objectName ${b64(path)},contentType ${b64(contentType)},cacheControl ${b64('3600')}`,
  } })
  if (created.status === 413) throw new FeedbackError('video_too_big')
  if (created.status !== 201 || !created.header('Location')) throw new FeedbackError('video_failed')
  // Без VITE_SUPABASE_URL (тесты, CI) TUS_URL относительный — new URL без абсолютной базы бросает.
  const loc = new URL(created.header('Location'), new URL(TUS_URL, globalThis.location?.href ?? 'http://localhost/'))
  if (TUS_URL.startsWith('https:')) loc.protocol = 'https:' // за прокси Storage может вернуть http
  const url = loc.toString()

  let offset = 0
  let fails = 0
  onBytes?.(0)
  while (offset < blob.size) {
    try {
      const chunk = blob.slice(offset, offset + TUS_CHUNK)
      const from = offset
      const res = await request('PATCH', url, {
        headers: { ...(await auth()), 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset) },
        body: chunk, onProgress: (n) => onBytes?.(from + n),
      })
      if (res.status === 204) {
        offset = Number(res.header('Upload-Offset')) || offset + chunk.size
        fails = 0
        onBytes?.(offset)
        continue
      }
      if (res.status === 413) throw new FeedbackError('video_too_big')
      if (res.status === 401 || res.status === 403) throw new FeedbackError('no_session')
      if (res.status !== 409 && res.status < 500) throw new FeedbackError('video_failed')
      throw new FeedbackError('network') // 409 (сервер ждет другой кусок) и 5xx — сверимся и повторим
    } catch (e) {
      if (!['network', 'upload_stalled'].includes(e?.code)) throw e
      fails += 1
      if (fails > TUS_MAX_FAILS) throw e
      if (pageHidden()) await untilVisible()
      else await wait(Math.min(8000, 1000 * fails))
      try {
        const head = await request('HEAD', url, { headers: await auth() })
        const at = Number(head.header('Upload-Offset'))
        if (head.status === 200 && Number.isFinite(at)) offset = at
      } catch { /* сверимся на следующей попытке */ }
    }
  }
}

// Видео до куска — одним запросом (как раньше), больше — с докачкой.
function videoUpload(path, blob, contentType, onBytes) {
  return blob.size > TUS_CHUNK ? resumableUpload(path, blob, contentType, onBytes) : xhrUpload(path, blob, contentType, onBytes)
}

// Одно вложение в Storage сразу после выбора (20.10.2026, предзагрузка): картинка — сжатием в JPEG,
// видео — как есть через XHR с прогрессом (onBytes). Возвращает путь `<userId>/<uuid>.<ext>` —
// его потом получат submit/attach. Ошибка — FeedbackError с понятным кодом.
export async function uploadAttachment(userId, file, { compress = compressToJpeg, onBytes = null, uploadVideo = videoUpload } = {}) {
  if (isOffline()) throw new FeedbackError('offline')
  if (!await hasSession(userId)) throw new FeedbackError('no_session')
  const problem = isVideoFile(file) ? attachmentProblem(file) : null // картинки решает сжатие
  if (problem) throw new FeedbackError(problem)
  const ext = videoExt(file)
  const path = userId + '/' + newId() + '.' + (ext ?? 'jpg')
  try {
    if (ext) {
      await uploadVideo(path, file, ext === 'mov' ? 'video/quicktime' : 'video/mp4', (b) => onBytes?.(b))
    } else {
      const blob = await compress(file, SHOT_MAX_PX, SHOT_QUALITY)
      const up = await withTimeout(supabase.storage.from('feedback').upload(path, blob, { upsert: false, contentType: 'image/jpeg' }))
      if (up?.error) throw up.error
    }
  } catch (e) {
    throw e instanceof FeedbackError ? e : new FeedbackError(ext ? 'video_failed' : 'shot_failed')
  }
  return path
}

// Убрать загруженные, но не отправленные вложения (убрали из формы, ушли с экрана). Тихо: не вышло —
// подчистит плановая уборка на сервере (Edge feedback-cleanup, раз в час, старше суток).
export async function discardAttachments(paths) {
  const list = (paths ?? []).filter(Boolean)
  if (!list.length) return
  try { await withTimeout(supabase.storage.from('feedback').remove(list)) } catch { /* уборка сервера */ }
}

// Дополнить обращение уже загруженными вложениями (предзагрузка, 20.10.2026).
export async function attachUploadedScreenshots(userId, id, paths) {
  if (isOffline()) throw new FeedbackError('offline')
  if (!await hasSession(userId)) throw new FeedbackError('no_session')
  if (!paths?.length) throw new FeedbackError('shot_failed')
  return callFn({ action: 'attach', id, screenshots: paths })
}

async function uploadScreenshots(userId, files, { compress = compressToJpeg, onProgress = null, uploadVideo = videoUpload } = {}) {
  if (!Array.isArray(files) || files.length > FEEDBACK_SHOTS_MAX) throw new FeedbackError('shot_limit')
  const paths = []
  const total = files.reduce((s, f) => s + (Number(f?.size) || 0), 0)
  let done = 0 // байты уже загруженных файлов
  const report = (loaded) => onProgress?.({ loaded: Math.min(total, loaded), total })
  let video = false
  try {
    report(0)
    for (const file of files) {
      // Видео (16.10) — как есть, без сжатия; проверки формата и 20 МБ — до загрузки.
      const problem = isVideoFile(file) ? attachmentProblem(file) : null // картинки решает сжатие
      if (problem) throw new FeedbackError(problem)
      const ext = videoExt(file)
      video = Boolean(ext)
      const path = userId + '/' + newId() + '.' + (ext ?? 'jpg')
      if (ext) {
        await uploadVideo(path, file, ext === 'mov' ? 'video/quicktime' : 'video/mp4', (b) => report(done + b))
      } else {
        const blob = await compress(file, SHOT_MAX_PX, SHOT_QUALITY)
        const up = await withTimeout(supabase.storage.from('feedback').upload(path, blob, { upsert: false, contentType: 'image/jpeg' }))
        if (up?.error) throw up.error
      }
      paths.push(path)
      done += Number(file?.size) || 0
      report(done)
    }
  } catch (e) {
    // Только файлы этой незавершенной загрузки, до создания обращения.
    if (paths.length) await supabase.storage.from('feedback').remove(paths).catch(() => {})
    throw e instanceof FeedbackError ? e : new FeedbackError(video ? 'video_failed' : 'shot_failed')
  }
  return paths
}

export async function attachFeedbackScreenshots(userId, id, files, compress = compressToJpeg, { onProgress = null, uploadVideo = videoUpload } = {}) {
  if (isOffline()) throw new FeedbackError('offline')
  if (!await hasSession(userId)) throw new FeedbackError('no_session')
  if (!files?.length) throw new FeedbackError('shot_failed')
  const screenshots = await uploadScreenshots(userId, files, { compress, onProgress, uploadVideo })
  return callFn({ action: 'attach', id, screenshots })
}

async function withScreenshotCounts(rows) {
  if (!rows.length) return rows
  let out = rows
  try {
    const { data, error } = await withTimeout(supabase.rpc('feedback_screenshot_counts'))
    if (!error && Array.isArray(data)) {
      const counts = new Map(data.filter((r) => Number.isInteger(r.screenshot_count)).map((r) => [r.feedback_id, r.screenshot_count]))
      if (counts.size) out = rows.map((r) => ({ ...r, screenshot_count: counts.get(r.id) ?? 0 }))
    }
  } catch { /* без счетчиков */ }
  return withScreenshotTimes(out)
}

// Когда приложены вложения после отправки (fb_37f0c1a8) — полем screenshot_times: { номер: ISO };
// по нему экран кладет вложение под свое дополнение (lib/feedback.js groupAttachments). Нет функции
// на сервере или сбой — список как есть: вложения общим блоком, как раньше.
async function withScreenshotTimes(rows) {
  try {
    const { data, error } = await withTimeout(supabase.rpc('feedback_screenshot_times'))
    if (error || !Array.isArray(data) || !data.length) return rows
    const by = new Map()
    for (const t of data) {
      if (!t?.feedback_id || !Number.isInteger(t.n) || !t.added_at) continue
      if (!by.has(t.feedback_id)) by.set(t.feedback_id, {})
      by.get(t.feedback_id)[t.n] = t.added_at
    }
    return by.size ? rows.map((r) => (by.has(r.id) ? { ...r, screenshot_times: by.get(r.id) } : r)) : rows
  } catch { return rows }
}
