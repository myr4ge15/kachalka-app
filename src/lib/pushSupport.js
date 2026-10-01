// Веб-пуши (v6.6.0): чистая логика без сети, Dexie и React. Браузерные факты
// (поддержка, iOS, «установлено на экран Домой», разрешение) собирает
// db/push.js и передаёт сюда готовыми значениями — так логику легко тестировать.

// Что показать в Настройках вместо/вместе с переключателем:
//   'off'         — ключ VAPID не задан в сборке: функции нет, строку не рисуем;
//   'ios-install' — iPhone/iPad в обычной вкладке Safari: пуши доступны только
//                   приложению, добавленному на экран «Домой» (iOS 16.4+);
//   'unsupported' — браузер не умеет пуши;
//   'denied'      — уведомления запрещены в настройках браузера/телефона;
//   'ok'          — можно включать и выключать.
export function pushAvailability({ configured, supported, isIOS, standalone, permission }) {
  if (!configured) return 'off'
  if (isIOS && !standalone) return 'ios-install'
  if (!supported) return 'unsupported'
  if (permission === 'denied') return 'denied'
  return 'ok'
}

// iPhone/iPad. iPadOS 13+ в Safari представляется «Macintosh», отличаем по тачу.
export function isIOSDevice({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true
  return platform === 'MacIntel' && maxTouchPoints > 1
}

// VAPID-ключ приходит строкой base64url, подписке нужен массив байт.
export function urlB64ToUint8Array(b64) {
  const s = String(b64 ?? '').trim()
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Подписка браузера (PushSubscription.toJSON()) → аргументы push_subscribe.
// Неполная подписка → null: такую на сервер не отправляем.
export function subscriptionArgs(json, userAgent = '') {
  const endpoint = json?.endpoint
  const p256dh = json?.keys?.p256dh
  const auth = json?.keys?.auth
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) return null
  if (!p256dh || !auth) return null
  return {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: String(userAgent).slice(0, 300) || null,
  }
}

// Подпись под строкой «Пуш-уведомления» для каждого состояния.
export function pushSubtitle(availability, enabled) {
  switch (availability) {
    case 'ios-install':
      return 'На iPhone — только из приложения на экране «Домой»: «Поделиться» → «На экран „Домой“», потом открой с иконки'
    case 'unsupported':
      return 'Этот браузер не умеет пуш-уведомления'
    case 'denied':
      return 'Запрещены в настройках браузера или телефона — разреши там и вернись сюда'
    default:
      return enabled
        ? 'Придут, даже когда приложение закрыто: реакции на твои тренировки'
        : 'Реакции на твои тренировки — даже когда приложение закрыто'
  }
}
