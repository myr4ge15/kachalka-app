// Куда вести по нажатию на пуш (v6.7.2). Service worker (public/push-sw.js)
// кладет tag уведомления в параметр `push` адреса приложения — и при холодном
// старте (openWindow), и сообщением в уже открытое окно. Здесь tag превращается
// в намерение. Сервер для этого ничего не меняет: tag уже несет нужный id.
//
//   reaction-<workoutId>-<reactorId> → Лента, прокрутка к этой тренировке
//   (v6.7.3; в v6.7.2 открывалась карточка тренировки — не прижилось).
//   feedback-<feedbackId> → экран «Написать разработчику» с ответом (v6.11.0).
//   friend → заявка в друзья / новый друг («Друзья», 15.10.2026) — экран «Друзья».
//   rest → «Отдых закончился» (v8.8.0, таймер отдыха) — к новой тренировке (композер).
//   update → «вышла новая версия» (v6.11.1): нажатие = согласие обновиться, приложение
//   применяет ждущую версию само, без плашки (components/UpdatePrompt.jsx).
//
// Остальные пуши (рекорды, рейтинг, напоминания) пока ведут на Главную, как раньше.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const REACTION_RE = new RegExp(`^reaction-(${UUID})-`, 'i')
const FEEDBACK_RE = new RegExp(`^feedback-(${UUID})$`, 'i')

export const PUSH_PARAM = 'push'
// tag пуша о новой версии — тот же, что ставит supabase/functions/push-update.
export const UPDATE_TAG = 'update'
// tag пуша таймера отдыха — тот же, что ставит supabase/functions/push-rest.
export const REST_TAG = 'rest'
// tag пушей «Друзей» — тот же, что ставит supabase/functions/push-friend.
export const FRIEND_TAG = 'friend'

export function pushIntentFromTag(tag) {
  if (typeof tag !== 'string') return null
  if (tag === UPDATE_TAG) return { type: 'update' }
  if (tag === REST_TAG) return { type: 'rest' }
  if (tag === FRIEND_TAG) return { type: 'friend' }
  const m = REACTION_RE.exec(tag)
  if (m) return { type: 'reaction', workoutId: m[1].toLowerCase() }
  const f = FEEDBACK_RE.exec(tag)
  if (f) return { type: 'feedback', feedbackId: f[1].toLowerCase() }
  return null
}

// Намерение из адреса (`?push=<tag>`) или null.
export function pushIntentFromUrl(href) {
  try {
    return pushIntentFromTag(new URL(href).searchParams.get(PUSH_PARAM))
  } catch {
    return null
  }
}

// Нажатие, которое не дошло сообщением (v8.9.2): service worker кладет адрес в Cache
// Storage (public/push-sw.js rememberIntent), приложение забирает его при открытии и
// возврате на экран. Запись одноразовая и живет PENDING_TTL_MS — старое нажатие не
// уводит с экрана через час. Нет записи / нет Cache API — null.
export const PUSH_INTENT_CACHE = 'push-intent'
export const PUSH_INTENT_KEY = '/__push-intent'
export const PENDING_TTL_MS = 2 * 60 * 1000

export async function takePendingPushUrl(now = Date.now(), store = globalThis.caches) {
  if (!store) return null
  try {
    const c = await store.open(PUSH_INTENT_CACHE)
    const res = await c.match(PUSH_INTENT_KEY)
    if (!res) return null
    await c.delete(PUSH_INTENT_KEY)
    const { url, at } = await res.json()
    const ok = typeof url === 'string' && Number.isFinite(at) && now - at >= 0 && now - at <= PENDING_TTL_MS
    if (store === globalThis.caches) appendPushLog('take', ok ? url : `старая запись (${Math.round((now - at) / 1000)} с)`)
    return ok ? url : null
  } catch {
    return null
  }
}

// Нажатие у свернутой PWA (v8.9.6). iPhone в этом случае только разворачивает приложение, а
// notificationclick не шлет (журнал владельца 15.10: «sw push» есть, «sw click» — нет). SW
// запоминает последний пуш с tag (public/push-sw.js rememberLastPush). При возврате: пуш свежий
// (LAST_PUSH_TTL_MS) и его уведомления уже нет в шторке → его нажали (или смахнули) — переходим.
// Уведомление еще висит — приложение открыли сами, никуда не уводим (запись оставляем).
// Нет getNotifications — не гадаем.
export const LAST_PUSH_KEY = '/__push-last'
export const LAST_PUSH_TTL_MS = 2 * 60 * 1000

export async function takeTappedPushUrl(reg, now = Date.now(), store = globalThis.caches) {
  if (!store || !reg?.getNotifications) return null
  try {
    const c = await store.open(PUSH_INTENT_CACHE)
    const res = await c.match(LAST_PUSH_KEY)
    if (!res) return null
    const { url, tag, at } = await res.json()
    if (typeof url !== 'string' || !Number.isFinite(at) || now - at < 0 || now - at > LAST_PUSH_TTL_MS) {
      await c.delete(LAST_PUSH_KEY)
      return null
    }
    const shown = await reg.getNotifications(tag ? { tag } : undefined)
    const log = store === globalThis.caches
    if (shown.length) {
      if (log) appendPushLog('last', `уведомление еще в шторке (${tag})`)
      return null
    }
    await c.delete(LAST_PUSH_KEY)
    if (log) appendPushLog('tapped', url)
    return url
  } catch {
    return null
  }
}

// Журнал нажатий (v8.9.4; с v8.9.6 — строка на запись). Общий с SW кэш, ключи
// /__push-log/<время>-<случайное>: без «прочитать список → записать» SW и приложение больше не
// затирают друг друга. Читаем последние PUSH_LOG_MAX, лишние удаляем. Отладка перехода по пушу
// на iPhone — админ видит журнал в «Уведомлениях».
export const PUSH_LOG_PREFIX = '/__push-log/'
export const PUSH_LOG_MAX = 40

export async function appendPushLog(ev, detail = '', store = globalThis.caches, now = Date.now()) {
  if (!store) return
  try {
    const c = await store.open(PUSH_INTENT_CACHE)
    const entry = { at: now, who: 'app', ev, detail: String(detail ?? '').slice(0, 160) }
    await c.put(`${PUSH_LOG_PREFIX}${now}-${Math.random().toString(36).slice(2, 8)}`,
      new Response(JSON.stringify(entry), { headers: { 'content-type': 'application/json' } }))
  } catch { /* журнал — не повод ломать приложение */ }
}

const logKeys = async (c) => (await c.keys())
  .map((r) => (typeof r === 'string' ? r : r.url))
  .filter((u) => new URL(u, 'http://x').pathname.startsWith(PUSH_LOG_PREFIX))

// Строки по времени (старые сверху). Сбой чтения — строкой «error», а не молчаливой пустотой.
export async function readPushLog(store = globalThis.caches) {
  if (!store) return []
  try {
    const c = await store.open(PUSH_INTENT_CACHE)
    const keys = await logKeys(c)
    const rows = []
    for (const k of keys) {
      try {
        const res = await c.match(k)
        if (res) rows.push({ key: k, ...(await res.json()) })
      } catch { /* битая строка — пропускаем */ }
    }
    rows.sort((x, y) => x.at - y.at)
    const extra = rows.slice(0, Math.max(0, rows.length - PUSH_LOG_MAX))
    for (const r of extra) await c.delete(r.key)
    return rows.slice(-PUSH_LOG_MAX).map(({ key: _key, ...r }) => r)
  } catch (e) {
    return [{ at: Date.now(), who: 'app', ev: 'error', detail: `журнал не прочитан: ${e?.message ?? e}` }]
  }
}

export async function clearPushLog(store = globalThis.caches) {
  try {
    const c = await store?.open(PUSH_INTENT_CACHE)
    if (!c) return
    for (const k of await logKeys(c)) await c.delete(k)
  } catch { /* нечего чистить */ }
}

// Проверка service worker'ов (v8.9.6, журнал нажатий): все регистрации устройства, их скрипт,
// подписка на пуши и ответ на «пинг» (версия push-sw.js). Старый код на пинг не отвечает.
function pingWorker(worker, ms = 1500) {
  return new Promise((resolve) => {
    if (!worker) { resolve(null); return }
    const ch = new MessageChannel()
    const timer = setTimeout(() => resolve(null), ms)
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data?.ver ?? '?') }
    try { worker.postMessage({ type: 'push-sw-ping' }, [ch.port2]) } catch { clearTimeout(timer); resolve(null) }
  })
}

export async function diagnoseServiceWorkers(sw = globalThis.navigator?.serviceWorker) {
  if (!sw?.getRegistrations) return []
  const regs = await sw.getRegistrations()
  return Promise.all(regs.map(async (r) => {
    const worker = r.active ?? r.waiting ?? r.installing ?? null
    let sub = null
    try { sub = (await r.pushManager?.getSubscription())?.endpoint ?? null } catch { /* нет доступа */ }
    return {
      scope: r.scope,
      script: worker?.scriptURL ?? '',
      state: r.active ? 'active' : r.waiting ? 'waiting' : r.installing ? 'installing' : 'нет',
      waiting: Boolean(r.waiting),
      controls: sw.controller ? sw.controller.scriptURL === worker?.scriptURL : false,
      sub: sub ? '…' + sub.slice(-16) : null,
      ver: await pingWorker(r.active),
    }
  }))
}

// Ранняя подписка на «перейди по пушу» (v8.9.3). На iPhone нажатие часто ЗАПУСКАЕТ приложение
// заново, и сообщение SW приходило раньше, чем React подписывался, — терялось, SW не получал
// ответа. Теперь слушатель ставит main.jsx до рендера: сразу отвечает SW и держит адрес,
// пока навигация (useAppNav → onPushOpen) его не заберет.
let pendingUrl = null
const pushSubs = new Set()

export function startPushListener(sw = globalThis.navigator?.serviceWorker) {
  if (!sw) return () => {}
  const onMessage = (e) => {
    if (e.data?.type !== 'push-open') return
    e.ports?.[0]?.postMessage('ok') // без ответа SW перезагрузит окно на адрес пуша
    appendPushLog('message', e.data.url)
    takePendingPushUrl() // сообщение дошло — запись в кэше не нужна
    if (pushSubs.size) for (const fn of pushSubs) fn(e.data.url)
    else pendingUrl = e.data.url
  }
  sw.addEventListener('message', onMessage)
  sw.startMessages?.() // Safari копит сообщения SW, пока их явно не включить
  return () => sw.removeEventListener('message', onMessage)
}

// Подписка навигации; адрес, пришедший до нее, отдается сразу.
export function onPushOpen(fn) {
  pushSubs.add(fn)
  if (pendingUrl) { const u = pendingUrl; pendingUrl = null; fn(u) }
  return () => pushSubs.delete(fn)
}

// Когда перепроверять запись SW после запуска, возврата из фона и фокуса (мс): iPhone сначала
// показывает приложение и только потом отдает нажатие SW — запись появляется позже.
export const PENDING_RECHECK_MS = [500, 1500, 3000, 6000]

// Тот же адрес без параметра `push` — чтобы F5 не открывал тренировку снова.
export function stripPushParam(href) {
  try {
    const url = new URL(href)
    if (!url.searchParams.has(PUSH_PARAM)) return null
    url.searchParams.delete(PUSH_PARAM)
    return url.pathname + url.search + url.hash
  } catch {
    return null
  }
}
