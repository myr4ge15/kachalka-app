// ============================================================================
// Обновление на экране загрузки (v6.13.0).
//
// При ЗАПУСКЕ приложения, если на сервере новая версия, держим сплэш, качаем ее
// и применяем — человек попадает сразу в новую версию, ничего не нажимая.
// Посреди работы ничего не перезапускаем: там по-прежнему плашка UpdatePrompt.
//
// Порядок:
//   1. нет service worker / офлайн / первая установка (нет active) → сразу внутрь;
//   2. version.json (no-store, 3 с) — версия та же или не узнали → внутрь
//      (здесь, в отличие от плашки, НЕ fail open: держать сплэш без уверенности нельзя);
//   3. новая версия уже скачана (reg.waiting) → применить;
//      иначе reg.update() и ждем установки, показывая прогресс: какие файлы новой
//      сборки нужны (манифест precache из нового sw.js) и сколько из них уже в кэше;
//   4. не успели за WAIT_MS (слабая сеть; если файлы еще идут — ждем до MAX_WAIT_MS,
//      пока прогресс двигается) → «Связь слабая…» и внутрь; докачанное
//      применится при следующем запуске (или по плашке);
//   5. применение: SKIP_WAITING ждущему SW → controllerchange → перезагрузка.
//      Флаг в sessionStorage — одна попытка на версию за сессию: если после
//      перезагрузки версия все та же (CDN отстал), не зацикливаемся.
//
// Чистые части (разбор манифеста, ключи кэша, прогресс) экспортируются и покрыты
// launchUpdate.test.js; DOM и сеть приходят параметрами.
// ============================================================================
import { isRealUpdate } from './pwaUpdate.js'

export const VERSION_TIMEOUT_MS = 3000
export const WAIT_MS = 12000          // сколько ждем скачивания на сплэше…
export const MAX_WAIT_MS = 30000      // …и до скольких продлеваем, пока загрузка идет
export const STALL_MS = 3000          // «идет» = прогресс двигался за последние STALL_MS
export const FALLBACK_SHOW_MS = 1800  // сколько висит «Связь слабая…»
export const APPLY_TIMEOUT_MS = 4000  // ждем смену контроллера, потом перезагружаем сами
export const POLL_MS = 250
export const TRIED_KEY = 'gym_app_update_tried'

// Манифест precache из текста sw.js (generateSW: precacheAndRoute([{url:"…",revision:"…"|null},…])).
// Не разобрали — [] (прогресс тогда «бегущий», без цифр).
export function parsePrecacheManifest(swText) {
  const out = []
  if (typeof swText !== 'string') return out
  const re = /url:"([^"]+)",revision:(?:null|"([^"]*)")/g
  let m
  while ((m = re.exec(swText))) out.push({ url: m[1], revision: m[2] ?? null })
  return out
}

// Ключ кэша Workbox для записи манифеста: абсолютный URL, у записей с revision —
// параметр __WB_REVISION__ (workbox-precaching createCacheKey).
export function precacheKey(entry, baseUrl) {
  const u = new URL(entry.url, baseUrl)
  if (entry.revision) u.searchParams.set('__WB_REVISION__', entry.revision)
  return u.href
}

// Прогресс по списку нужных ключей и тому, что сейчас в кэше.
export function downloadProgress(needed, haveSet) {
  if (!needed.length) return null
  let done = 0
  for (const k of needed) if (haveSet.has(k)) done++
  return { done, total: needed.length, pct: Math.round((done / needed.length) * 100) }
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms))

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
}

async function precacheKeys(cachesApi) {
  if (!cachesApi) return new Set()
  try {
    const names = await cachesApi.keys()
    const name = names.find((n) => n.startsWith('workbox-precache'))
    if (!name) return new Set()
    const cache = await cachesApi.open(name)
    return new Set((await cache.keys()).map((r) => r.url))
  } catch {
    return new Set()
  }
}

// ui: { start(version), progress(p|null), installing(), fallback() } — все необязательны.
// Возвращает 'skip' | 'none' | 'retried' | 'fallback' | 'applied'. После 'applied'
// страница перезагружается.
export async function runLaunchUpdate({
  sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null,
  online = typeof navigator !== 'undefined' ? navigator.onLine : false,
  fetchFn = typeof fetch !== 'undefined' ? fetch : null,
  cachesApi = typeof caches !== 'undefined' ? caches : null,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  versionUrl,
  currentVersion,
  ui = {},
  now = () => Date.now(),
  sleep = realSleep,
  reload = () => window.location.reload(),
  waitMs = WAIT_MS,
  maxWaitMs = MAX_WAIT_MS,
} = {}) {
  if (!sw || !online || !fetchFn) return 'skip'
  let reg
  try { reg = await withTimeout(sw.getRegistration(), 2000) } catch { return 'skip' }
  if (!reg?.active) return 'skip'

  let server = null
  try {
    const res = await withTimeout(fetchFn(versionUrl, { cache: 'no-store' }), VERSION_TIMEOUT_MS)
    if (res.ok) server = (await res.json())?.version ?? null
  } catch { /* офлайн/таймаут */ }
  if (!server || !isRealUpdate(currentVersion, server)) return 'none'

  let tried = null
  try { tried = storage?.getItem(TRIED_KEY) } catch { /* приватный режим */ }
  if (tried === String(server)) return 'retried'

  ui.start?.(String(server))
  const started = now()
  const deadline = started + waitMs
  const hardDeadline = started + Math.max(waitMs, maxWaitMs)
  let lastDone = -1
  let lastMoveAt = started
  const keepWaiting = () => {
    const t = now()
    if (t < deadline) return true
    return t < hardDeadline && t - lastMoveAt < STALL_MS
  }

  let worker = reg.waiting
  if (!worker) {
    const before = await precacheKeys(cachesApi)
    reg.update().catch(() => {})
    let needed = null // ключи новой сборки, которых не было в кэше
    while (keepWaiting()) {
      if (reg.waiting) { worker = reg.waiting; break }
      const inst = reg.installing
      if (inst && needed === null && fetchFn) {
        try {
          const res = await fetchFn(inst.scriptURL, { cache: 'no-store' })
          const text = res.ok ? await res.text() : ''
          needed = parsePrecacheManifest(text).map((e) => precacheKey(e, inst.scriptURL)).filter((k) => !before.has(k))
        } catch { needed = [] }
      }
      if (needed?.length) {
        const p = downloadProgress(needed, await precacheKeys(cachesApi))
        if (p.done !== lastDone) { lastDone = p.done; lastMoveAt = now() }
        ui.progress?.(p)
      }
      await sleep(POLL_MS)
    }
  }

  if (!worker) {
    ui.fallback?.()
    await sleep(FALLBACK_SHOW_MS)
    return 'fallback'
  }

  ui.installing?.()
  try { storage?.setItem(TRIED_KEY, String(server)) } catch { /* приватный режим */ }
  await new Promise((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    sw.addEventListener?.('controllerchange', finish, { once: true })
    try { worker.postMessage({ type: 'SKIP_WAITING' }) } catch { finish() }
    sleep(APPLY_TIMEOUT_MS).then(finish)
  })
  reload()
  return 'applied'
}
