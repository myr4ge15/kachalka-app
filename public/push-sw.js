// Веб-пуши (v6.6.0): обработчики уведомлений для service worker.
// Подключается в сгенерированный Workbox'ом sw.js через importScripts
// (vite.config.js → workbox.importScripts), поэтому лежит в public/ и пишется
// на чистом JS без сборки. Отправитель — Edge Function (supabase/functions/
// _shared/webpush.ts): payload — JSON { title, body, url?, tag? }.
//
// Каждый пуш ОБЯЗАН показать уведомление: «тихие» пуши браузеры запрещают,
// а Safari за них отзывает подписку.

/* global self, clients, URL */

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
    data: { url: new URL(data.url || './', scope).href },
  }
  if (data.tag) {
    options.tag = data.tag
    // Повтор с тем же tag (вторая реакция того же человека) — снова со звуком.
    options.renotify = true
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// Нажатие: переключаемся на уже открытое окно приложения, иначе открываем новое.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || self.registration.scope
  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope) && 'focus' in w) return w.focus()
    }
    if (clients.openWindow) return clients.openWindow(target)
  })())
})
