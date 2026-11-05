// Отправка отчетов об ошибках (чистая часть — lib/errorReport.js). Онлайн-модуль вне очередей синка:
// ничего не пишет в Dexie, сбои тихие, офлайн отчеты не копятся. Без токена — пустышка.
import { parseHawkToken, collectorUrl, buildEvent, toHawkMessage, createLimiter } from './errorReport.js'

const DEVICE_KEY = 'gym_app_diag_id'

let sender = null

function randomHex(bytes) {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Случайный id устройства для счета «сколько людей затронуло». Не id учетки и нигде не связан с ней.
function deviceId(storage) {
  try {
    let id = storage.getItem(DEVICE_KEY)
    if (!id) {
      id = randomHex(8)
      storage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return undefined
  }
}

// Подключает перехват window.onerror / unhandledrejection. Повторный вызов — без второго подписчика.
export function initErrorReporter({
  token,
  release,
  win = window,
  fetchFn = (...a) => fetch(...a),
  now = () => Date.now(),
} = {}) {
  const parsed = parseHawkToken(token)
  if (!parsed || sender) return Boolean(sender)
  const url = collectorUrl(parsed)
  const environment = String(release).includes('-beta') ? 'beta' : 'production'
  const allow = createLimiter()
  const id = deviceId(win.localStorage)

  sender = (error, { source = 'generic', handled = false } = {}) => {
    try {
      if (win.navigator?.onLine === false) return
      const standalone = Boolean(win.matchMedia?.('(display-mode: standalone)').matches || win.navigator?.standalone)
      const event = buildEvent(error, {
        eventId: randomHex(16),
        timestamp: now() / 1000,
        release,
        environment,
        source,
        handled,
        deviceId: id,
        url: win.location?.href,
        tags: { standalone: String(standalone) },
      })
      if (!event) return
      const top = event.exception.values[0]
      if (!allow(`${top.type}|${top.value}`, now())) return
      // Приемник не возвращает CORS-заголовки: no-cors + text/plain, ответ не читаем.
      fetchFn(url, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify(toHawkMessage(event, token)),
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        keepalive: true,
      }).catch(() => {})
    } catch {
      // отчет об ошибке не должен сам ронять приложение
    }
  }

  win.addEventListener('error', (e) => sender(e.error ?? e.message, { source: 'onerror' }))
  win.addEventListener('unhandledrejection', (e) => sender(e.reason, { source: 'onunhandledrejection' }))
  return true
}

// Ручной отчет (ErrorBoundary и т. п.). Не подключено — ничего не делает.
export function captureError(error, opts) {
  sender?.(error, opts)
}

// Только для тестов.
export function resetErrorReporter() {
  sender = null
}
