import { describe, it, expect } from 'vitest'
import { isWeakPin, WEAK_PIN_TEXT } from './pinPolicy.js'

// Тот же список примеров — в supabase/functions/_shared/pin_test.ts (паритет клиент/сервер).
const WEAK = ['0000', '1111', '9999', '1234', '2345', '7890', '4321', '0987', '1212', '1122', '2580', '2000', '6969', '1004']
const OK = ['4826', '1357', '8402', '3141', '5091', '2468']

describe('isWeakPin', () => {
  it.each(WEAK)('%s — слабый', (p) => expect(isWeakPin(p)).toBe(true))
  it.each(OK)('%s — нормальный', (p) => expect(isWeakPin(p)).toBe(false))
  it('не PIN — не «слабый» (длину проверяет другое правило)', () => {
    expect(isWeakPin('123')).toBe(false)
    expect(isWeakPin(null)).toBe(false)
  })
  it('текст подсказки на месте', () => expect(WEAK_PIN_TEXT).toMatch(/простой PIN/))
})
