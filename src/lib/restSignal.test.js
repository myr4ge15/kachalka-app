import { afterEach, describe, expect, it, vi } from 'vitest'
import { holdScreen, releaseScreen } from './restSignal.js'

// Wake Lock таймера отдыха (аудит 16.10, 🟢-5).
function fakeWakeLock() {
  const taken = []
  let resolve
  const request = vi.fn(() => new Promise((r) => { resolve = r }))
  const grant = () => {
    const s = { released: false, release: vi.fn(function () { this.released = true }) }
    taken.push(s)
    resolve(s)
    return s
  }
  vi.stubGlobal('navigator', { wakeLock: { request } })
  return { request, grant, taken }
}

describe('holdScreen / releaseScreen', () => {
  afterEach(() => { releaseScreen(); vi.unstubAllGlobals() })

  it('снятие, пока запрос в пути, — пришедшая блокировка сразу освобождается', async () => {
    const wl = fakeWakeLock()
    const held = holdScreen()
    releaseScreen()
    const s = wl.grant()
    expect(await held).toBe(false)
    expect(s.release).toHaveBeenCalled()
  })

  it('два одновременных вызова — один запрос, одна блокировка', async () => {
    const wl = fakeWakeLock()
    const a = holdScreen()
    const b = holdScreen()
    const s = wl.grant()
    expect(await a).toBe(true)
    expect(await b).toBe(true)
    expect(wl.request).toHaveBeenCalledTimes(1)
    releaseScreen()
    expect(s.release).toHaveBeenCalledTimes(1)
  })

  it('без Wake Lock — тихий false', async () => {
    vi.stubGlobal('navigator', {})
    expect(await holdScreen()).toBe(false)
  })
})
