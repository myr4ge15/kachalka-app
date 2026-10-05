import { describe, expect, it } from 'vitest'
import { pushIntentFromTag, pushIntentFromUrl, stripPushParam } from './pushIntent.js'

const W = '3f2c9a1e-0b4d-4c7e-9a10-5e6f7a8b9c0d'
const U = 'aa11bb22-cc33-4d44-8e55-66ff77889900'

describe('pushIntent', () => {
  it('реакция ведет к своей тренировке в Ленте', () => {
    expect(pushIntentFromTag(`reaction-${W}-${U}`)).toEqual({ type: 'reaction', workoutId: W })
  })

  it('id из tag приводится к нижнему регистру', () => {
    expect(pushIntentFromTag(`reaction-${W.toUpperCase()}-${U}`)?.workoutId).toBe(W)
  })

  it('ответ на обращение ведет на экран обратной связи', () => {
    expect(pushIntentFromTag(`feedback-${W.toUpperCase()}`)).toEqual({ type: 'feedback', feedbackId: W })
    expect(pushIntentFromTag(`feedback-${W}-x`)).toBeNull()
  })

  it('остальные и битые tag — без намерения', () => {
    expect(pushIntentFromTag(`record-${W}`)).toBeNull()
    expect(pushIntentFromTag('reaction-123-456')).toBeNull()
    expect(pushIntentFromTag('')).toBeNull()
    expect(pushIntentFromTag(null)).toBeNull()
  })

  it('читает намерение из адреса и не падает на мусоре', () => {
    const href = `https://x.github.io/kachalka-app/?push=${encodeURIComponent(`reaction-${W}-${U}`)}`
    expect(pushIntentFromUrl(href)).toEqual({ type: 'reaction', workoutId: W })
    expect(pushIntentFromUrl('https://x.github.io/kachalka-app/')).toBeNull()
    expect(pushIntentFromUrl('не адрес')).toBeNull()
  })

  it('убирает только параметр push, сохраняя остальное', () => {
    expect(stripPushParam('https://x.io/app/?push=a&b=1#h')).toBe('/app/?b=1#h')
    expect(stripPushParam('https://x.io/app/?push=a')).toBe('/app/')
    expect(stripPushParam('https://x.io/app/')).toBeNull()
  })
})
