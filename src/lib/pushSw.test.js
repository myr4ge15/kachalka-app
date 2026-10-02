// Логика нажатия на пуш в service worker (public/push-sw.js, v6.7.4). Файл —
// чистый JS без сборки, поэтому исполняем его текст с подмененными self/clients.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SCOPE = 'https://x.github.io/kachalka-app/'
const TARGET = `${SCOPE}?push=reaction-abc`
const code = readFileSync(new URL('../../public/push-sw.js', import.meta.url), 'utf8')

function loadSw(wins) {
  const handlers = {}
  const self = {
    registration: { scope: SCOPE, showNotification: vi.fn() },
    addEventListener: (type, fn) => { handlers[type] = fn },
  }
  const clients = {
    matchAll: vi.fn(async () => wins),
    openWindow: vi.fn(async () => null),
  }
  new Function('self', 'clients', 'URL', 'MessageChannel', code)(self, clients, URL, MessageChannel)
  return { clients, click: () => {
    let done
    handlers.notificationclick({
      notification: { close: vi.fn(), data: { url: TARGET } },
      waitUntil: (p) => { done = p },
    })
    return done
  } }
}

// Окно приложения: answer=true — страница подтверждает переход.
function makeWin({ answer }) {
  const win = {
    url: `${SCOPE}`,
    focus: vi.fn(async () => win),
    navigate: vi.fn(async () => win),
    postMessage: vi.fn((msg, ports) => {
      if (answer) ports[0].postMessage('ok')
    }),
  }
  return win
}

describe('push-sw: нажатие на уведомление', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
  afterEach(() => vi.useRealTimers())

  it('открытое окно приняло переход — без перезагрузки', async () => {
    const win = makeWin({ answer: true })
    const { click, clients } = loadSw([win])
    await click()
    expect(win.focus).toHaveBeenCalled()
    expect(win.postMessage).toHaveBeenCalledWith({ type: 'push-open', url: TARGET }, expect.any(Array))
    expect(win.navigate).not.toHaveBeenCalled()
    expect(clients.openWindow).not.toHaveBeenCalled()
  })

  it('окно в фоне не ответило — перезагружаем его на адрес пуша', async () => {
    const win = makeWin({ answer: false })
    const { click, clients } = loadSw([win])
    const done = click()
    await vi.advanceTimersByTimeAsync(2100)
    await done
    expect(win.navigate).toHaveBeenCalledWith(TARGET)
    expect(clients.openWindow).not.toHaveBeenCalled()
  })

  it('приложение закрыто — открываем новое окно с адресом пуша', async () => {
    const { click, clients } = loadSw([])
    await click()
    expect(clients.openWindow).toHaveBeenCalledWith(TARGET)
  })
})
