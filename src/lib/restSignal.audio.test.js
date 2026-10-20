// Сигнал конца отдыха (lib/restSignal.js; покрытие тестами 20.10.2026: было 48 % строк):
// «без звука» — ничего; звук — два тона; режим iPhone mix → ambient (молчит в беззвучном),
// loud → playback, потом обратно auto; нет Web Audio или он бросил — тихий false.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function fakeAudio() {
  const made = { osc: 0, ctx: 0, resumed: 0, started: 0 }
  const node = () => ({ connect: vi.fn(), start: vi.fn(() => { made.started++ }), stop: vi.fn() })
  class Ctx {
    constructor() { made.ctx++; this.state = 'suspended'; this.currentTime = 0; this.destination = {} }
    resume() { made.resumed++; this.state = 'running' }
    createBuffer() { return {} }
    createBufferSource() { return node() }
    createOscillator() { made.osc++; return { ...node(), frequency: {}, type: '' } }
    createGain() { return { connect: vi.fn(), gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } } }
  }
  return { Ctx, made }
}

let mod, audio, session
beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  audio = fakeAudio()
  session = { type: 'auto' }
  vi.stubGlobal('window', { AudioContext: audio.Ctx })
  vi.stubGlobal('navigator', { audioSession: session })
  mod = await import('./restSignal.js')
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('playRestDone', () => {
  it('«без звука» — платформу не трогаем', () => {
    expect(mod.playRestDone('off')).toBe(false)
    expect(audio.made.ctx).toBe(0)
  })

  it('mix: два тона, ambient на время сигнала, потом auto', () => {
    expect(mod.playRestDone('mix')).toBe(true)
    expect(audio.made.osc).toBe(2)
    expect(audio.made.resumed).toBe(1)
    expect(session.type).toBe('ambient')
    vi.advanceTimersByTime(800)
    expect(session.type).toBe('auto')
  })

  it('loud — playback (звучит и в беззвучном режиме)', () => {
    mod.playRestDone('loud')
    expect(session.type).toBe('playback')
  })

  it('разблокировка в жесте создает контекст один раз, сигнал берет его же', () => {
    expect(mod.unlockRestAudio()).toBe(true)
    mod.playRestDone()
    expect(audio.made.ctx).toBe(1)
    expect(audio.made.started).toBeGreaterThanOrEqual(3) // пустой буфер + два тона
  })

  it('нет Web Audio — false, без исключений; AudioSession нет — звук все равно идет', async () => {
    vi.resetModules()
    vi.stubGlobal('window', {})
    const m = await import('./restSignal.js')
    expect(m.unlockRestAudio()).toBe(false)
    expect(m.playRestDone('mix')).toBe(false)

    vi.resetModules()
    vi.stubGlobal('window', { AudioContext: audio.Ctx })
    vi.stubGlobal('navigator', {})
    const m2 = await import('./restSignal.js')
    expect(m2.playRestDone('mix')).toBe(true)
  })

  it('Web Audio бросил — тихий false', async () => {
    vi.resetModules()
    vi.stubGlobal('window', { AudioContext: class { constructor() { throw new Error('NotAllowed') } } })
    const m = await import('./restSignal.js')
    expect(m.unlockRestAudio()).toBe(false)
    expect(m.playRestDone('mix')).toBe(false)
  })
})
