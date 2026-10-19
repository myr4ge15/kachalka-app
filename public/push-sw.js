// Веб-пуши (v6.6.0): обработчики уведомлений для service worker.
// Подключается в сгенерированный Workbox'ом sw.js через importScripts
// (vite.config.js → workbox.importScripts), поэтому лежит в public/ и пишется
// на чистом JS без сборки. Отправитель — Edge Function (supabase/functions/
// _shared/webpush.ts): payload — JSON { title, body, url?, tag? }.
//
// Каждый пуш ОБЯЗАН показать уведомление: «тихие» пуши браузеры запрещают,
// а Safari за них отзывает подписку.

/* global self, clients, URL, MessageChannel, setTimeout, clearTimeout, caches, Response */

// Версия этого файла (v8.9.6) = версия приложения; сверяет тест src/lib/pushIntent.test.js.
// Отвечает на «пинг» журнала нажатий: так видно, что пуши обрабатывает свежий код.
const PUSH_SW_VER = '9.5.2'

self.addEventListener('push', (event) => {
  let data
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  // Журнал (v8.9.5): пуш пришел в ЭТОТ код. Есть «sw push», нет «sw click» после нажатия —
  // значит, нажатие iOS не передает; нет и «sw push» — работает старый файл.
  const logged = logPush('push', data.tag || data.title || '')
  const scope = self.registration.scope
  const title = data.title || 'kachalka-app'
  const options = {
    body: data.body || '',
    icon: new URL('icon-192.png', scope).href,
    lang: 'ru',
    data: { url: openUrl(data, scope) },
  }
  if (data.tag) {
    options.tag = data.tag
    // Повтор с тем же tag (вторая реакция того же человека) — снова со звуком.
    options.renotify = true
  }
  const work = [self.registration.showNotification(title, options), logged]
  // v8.9.6: у СВЕРНУТОЙ PWA iPhone нажатие на уведомление только разворачивает приложение,
  // notificationclick не приходит (журнал владельца 15.10). Запоминаем последний пуш с tag —
  // приложение при возврате увидит, что его уведомления уже нет в шторке, и перейдет само.
  if (data.tag) work.push(rememberLastPush(options.data.url, data.tag))
  // «Вышла новая версия» (v6.11.1): сразу скачиваем новый sw.js, пока уведомление
  // висит. К нажатию версия уже ждет установленной, и приложение применяет ее без
  // плашки (UpdatePrompt, ?push=update) — вместо «открыл, подождал, нажал Обновить».
  if (data.tag === 'update' && self.registration.update) {
    work.push(self.registration.update().catch(() => {}))
  }
  event.waitUntil(Promise.all(work))
})

// Адрес, который откроет нажатие. tag кладем в `?push=` (v6.7.2): по нему
// приложение понимает, что показать (src/lib/pushIntent.js — реакция → Лента у
// оцененной тренировки). Раньше все пуши вели на «./», то есть на Главную.
function openUrl(data, scope) {
  const url = new URL(data.url || './', scope)
  if (data.tag) url.searchParams.set('push', data.tag)
  return url.href
}

// Сколько ждать от открытого окна подтверждения, что оно приняло переход (мс).
const ACK_MS = 2000

// Попросить открытое окно перейти по адресу и дождаться ответа через MessageChannel.
// Свернутую PWA телефон «замораживает», и сообщение может не дойти; старая
// версия страницы (до обновления) его не понимает. В обоих случаях ответа нет.
function askToOpen(win, url) {
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    const timer = setTimeout(() => resolve(false), ACK_MS)
    ch.port1.onmessage = () => { clearTimeout(timer); resolve(true) }
    try {
      win.postMessage({ type: 'push-open', url }, [ch.port2])
    } catch {
      clearTimeout(timer)
      resolve(false)
    }
  })
}

// Нажатие (v6.7.4): приложение уже открыто — выводим окно вперед и просим его
// перейти; не ответило — перезагружаем это окно сразу на нужный адрес (тот же путь,
// что при холодном старте). Окна нет — открываем новое.
// Раньше сообщение уходило без подтверждения: из фона приложение оставалось там,
// где было (обычно на Главной).
// v8.9.2: куда вести — еще и в общий кэш. На iPhone свернутая PWA «заморожена»: ответ на
// сообщение не успевает, navigate() в PWA не работает, и окно всплывало на прежнем экране.
// Приложение забирает запись при возврате на экран (src/lib/pushIntent.js takePendingPushUrl).
// Имя кэша и ключ — те же, что там.
const INTENT_CACHE = 'push-intent'
const INTENT_KEY = '/__push-intent'
async function rememberIntent(url) {
  try {
    const c = await caches.open(INTENT_CACHE)
    await c.put(INTENT_KEY, new Response(JSON.stringify({ url, at: Date.now() }), { headers: { 'content-type': 'application/json' } }))
  } catch { /* нет Cache API — остаются сообщение и navigate */ }
}

// Журнал нажатий (v8.9.4, отладка перехода по пушу на iPhone): последние шаги SW и
// приложения в том же кэше; админ видит его в «Уведомлениях» (src/lib/pushIntent.js).
// v8.9.6: строка журнала — ОТДЕЛЬНАЯ запись (ключ /__push-log/<время>-<случайное>), без
// «прочитать список → дописать → записать»: SW и приложение писали почти одновременно и
// затирали друг друга. Читает и подрезает до 40 строк приложение (src/lib/pushIntent.js).
const LOG_PREFIX = '/__push-log/'
async function logPush(ev, detail) {
  try {
    const c = await caches.open(INTENT_CACHE)
    const at = Date.now()
    const entry = { at, who: 'sw', ev, detail: detail == null ? '' : String(detail).slice(0, 160) }
    await c.put(LOG_PREFIX + at + '-' + Math.random().toString(36).slice(2, 8),
      new Response(JSON.stringify(entry), { headers: { 'content-type': 'application/json' } }))
  } catch { /* журнал — не повод ломать переход */ }
}

const LAST_KEY = '/__push-last'
async function rememberLastPush(url, tag) {
  try {
    const c = await caches.open(INTENT_CACHE)
    await c.put(LAST_KEY, new Response(JSON.stringify({ url, tag, at: Date.now() }), { headers: { 'content-type': 'application/json' } }))
  } catch { /* без записи — переход только по нажатию */ }
}
async function forgetLastPush() {
  try { await (await caches.open(INTENT_CACHE)).delete(LAST_KEY) } catch { /* нечего забывать */ }
}

async function openFromNotification(target) {
  await forgetLastPush() // нажатие пришло — дальше обычный путь, догадка при возврате не нужна
  await rememberIntent(target)
  const scope = self.registration.scope
  const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  const win = wins.find((w) => w.url.startsWith(scope))
  await logPush('windows', `${wins.length} шт., наше: ${win ? win.visibilityState + ', ' + (win.focused ? 'в фокусе' : 'не в фокусе') : 'нет'}`)
  if (win) {
    let shown = win
    try { shown = (await win.focus()) || win } catch (e) { await logPush('focus-error', e && e.message) }
    const acked = await askToOpen(shown, target)
    await logPush('ack', acked ? 'окно ответило' : 'ответа нет за 2 с')
    if (acked) return
    if ('navigate' in shown) {
      try {
        const nav = await shown.navigate(target)
        await logPush('navigate', nav ? 'ок' : 'вернул null')
        if (nav) return
      } catch (e) { await logPush('navigate-error', e && e.message) }
    } else {
      await logPush('navigate', 'нет в этом браузере')
    }
  }
  if (clients.openWindow) {
    try {
      await clients.openWindow(target)
      await logPush('openWindow', 'ок')
    } catch (e) { await logPush('openWindow-error', e && e.message) }
  }
}

// Пинг из журнала нажатий (v8.9.6): ответить версией и записать шаг в журнал — так видно,
// что код свежий и что записи SW доходят до приложения (общий Cache Storage).
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'push-sw-ping') return
  const port = event.ports && event.ports[0]
  event.waitUntil(logPush('ping', PUSH_SW_VER).then(() => { if (port) port.postMessage({ ver: PUSH_SW_VER }) }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || self.registration.scope
  event.waitUntil(logPush('click', target).then(() => openFromNotification(target)))
})
