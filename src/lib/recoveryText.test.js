import { describe, it, expect } from 'vitest'
import { leadTarget, leadSince, cardioLine } from './recoveryText.js'

describe('recoveryText (v7.5.6)', () => {
  it('«пора проработать» — винительный падеж', () => {
    expect(leadTarget('спина')).toBe('Пора проработать спину')
    expect(leadTarget('ноги')).toBe('Пора проработать ноги')
  })
  it('давность без рода глагола', () => {
    expect(leadSince(8)).toBe('последний раз 8 дней назад')
    expect(leadSince(21)).toBe('последний раз 21 день назад')
  })
  it('кардио — своей фразой', () => {
    expect(cardioLine(8)).toBe('Кардио не было 8 дней')
    expect(cardioLine(22)).toBe('Кардио не было 22 дня')
  })
})
