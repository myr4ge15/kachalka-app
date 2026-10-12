// @vitest-environment jsdom
// Хаб событий «сеть / возврат на вкладку / повторный тап» (lib/appEvents.js). Экраны
// подменяют его заглушкой, поэтому сам хаб проверяем здесь: от него зависит, что
// Лента, профиль участника и рейтинг обновятся при возврате в приложение и с сетью.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Модуль держит подписки и флаг «слушатели навешены» на уровне модуля — свежий на тест.
let ev
beforeEach(async () => {
  vi.resetModules()
  ev = await import('./appEvents.js')
})

const setVisibility = (v) => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })

describe('appEvents', () => {
  it('online/offline окна → onOnline/onOffline', () => {
    const on = vi.fn(); const off = vi.fn()
    ev.onOnline(on); ev.onOffline(off)
    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('offline'))
    expect(on).toHaveBeenCalledTimes(1)
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('onResume — только когда вкладка снова видима', () => {
    const fn = vi.fn()
    ev.onResume(fn)
    setVisibility('hidden'); document.dispatchEvent(new Event('visibilitychange'))
    expect(fn).not.toHaveBeenCalled()
    setVisibility('visible'); document.dispatchEvent(new Event('visibilitychange'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('отписка снимает слушателя', () => {
    const fn = vi.fn()
    const off = ev.onOnline(fn)
    off()
    window.dispatchEvent(new Event('online'))
    expect(fn).not.toHaveBeenCalled()
  })

  it('повторный тап по вкладке отдает ее id', () => {
    const fn = vi.fn()
    ev.onReselect(fn)
    ev.emitReselect('feed')
    expect(fn).toHaveBeenCalledWith('feed')
  })

  it('упавший слушатель не мешает остальным', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const good = vi.fn()
    ev.onReselect(() => { throw new Error('boom') })
    ev.onReselect(good)
    ev.emitReselect('home')
    expect(good).toHaveBeenCalledWith('home')
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
