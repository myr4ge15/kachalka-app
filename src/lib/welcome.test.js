import { describe, expect, it } from 'vitest'
import {
  WELCOME_STEPS, isWelcomePending, markWelcomeDone, markWelcomePending, stepAfterSwipe, welcomeKey,
} from './welcome.js'

function memStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }
}

describe('welcome', () => {
  it('регистрация ставит «pending», закрытие — «done»; отметка своя у каждой учетки', () => {
    const st = memStorage()
    expect(isWelcomePending('u1', st)).toBe(false)
    markWelcomePending('u1', st)
    expect(isWelcomePending('u1', st)).toBe(true)
    expect(isWelcomePending('u2', st)).toBe(false)
    markWelcomeDone('u1', st)
    expect(isWelcomePending('u1', st)).toBe(false)
    expect(st.m.get(welcomeKey('u1'))).toBe('done')
  })

  it('показанный лист второй раз не вернется', () => {
    const st = memStorage()
    markWelcomeDone('u1', st)
    markWelcomePending('u1', st)
    expect(isWelcomePending('u1', st)).toBe(false)
  })

  it('без учетки и без хранилища — тихо «нет отметки»', () => {
    const broken = { getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('x') } }
    expect(() => markWelcomePending('u1', broken)).not.toThrow()
    expect(isWelcomePending('u1', broken)).toBe(false)
    expect(isWelcomePending(null, memStorage())).toBe(false)
    expect(isWelcomePending('u1', null)).toBe(false)
  })

  it('stepAfterSwipe: короткий жест — на месте, влево — вперед, вправо — назад, в пределах', () => {
    expect(stepAfterSwipe(1, -20, 4)).toBe(1)
    expect(stepAfterSwipe(1, -80, 4)).toBe(2)
    expect(stepAfterSwipe(1, 80, 4)).toBe(0)
    expect(stepAfterSwipe(0, 80, 4)).toBe(0)
    expect(stepAfterSwipe(3, -80, 4)).toBe(3)
  })

  it('карточки: у каждой значок, заголовок и текст', () => {
    expect(WELCOME_STEPS.length).toBeGreaterThanOrEqual(3)
    for (const s of WELCOME_STEPS) {
      expect(s.e && s.title && s.text).toBeTruthy()
    }
  })
})
