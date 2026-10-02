// Веб-пуши (v6.6.0): обработчики уведомлений для service worker.
// Подключается в сгенерированный Workbox'ом sw.js через importScripts
// (vite.config.js → workbox.importScripts), поэтому лежит в public/ и пишется
// на чистом JS без сборки. Отправитель — Edge Function (supabase/functions/
// _shared/webpush.ts): payload — JSON { title, body, url?, tag? }.
//
// Каждый пуш ОБЯЗАН показать уведомление: «тихие» пуши браузеры запрещают,
// а Safari за них отзывает подписку.

/* global self, clients, URL, MessageChannel, setTimeout, clearTimeout */

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
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
  event.waitUntil(self.registration.showNotification(title, options))
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
async function openFromNotification(target) {
  const scope = self.registration.scope
  const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  const win = wins.find((w) => w.url.startsWith(scope))
  if (win) {
    let shown = win
    try { shown = (await win.focus()) || win } catch { /* фокус не дали — все равно пробуем */ }
    if (await askToOpen(shown, target)) return
    if ('navigate' in shown) {
      try {
        const nav = await shown.navigate(target)
        if (nav) return
      } catch { /* окно не под этим SW — откроем новое */ }
    }
  }
  if (clients.openWindow) await clients.openWindow(target)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || self.registration.scope
  event.waitUntil(openFromNotification(target))
})
