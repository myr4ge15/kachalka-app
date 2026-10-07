import { describe, it, expect } from 'vitest'
import { isWeakPin, WEAK_PIN_TEXT } from './pinPolicy.js'

// Тот же список примеров — в supabase/functions/_shared/pin_test.ts (паритет клиент/сервер).
const WEAK = ['1234', '0000', '1111', '1212', '7777', '2000', '4444', '2222', '6969', '9999']
// С П4 (07.10.2026) лесенки и «почти частые» снова разрешены — только список выше.
const OK = ['4826', '1357', '8402', '3141', '5091', '2468', '2345', '4321', '1122', '2580', '1004']

describe('isWeakPin', () => {
  it.each(WEAK)('%s — слабый', (p) => expect(isWeakPin(p)).toBe(true))
  it.each(OK)('%s — нормальный', (p) => expect(isWeakPin(p)).toBe(false))
  it('не PIN — не «слабый» (длину проверяет другое правило)', () => {
    expect(isWeakPin('123')).toBe(false)
    expect(isWeakPin(null)).toBe(false)
  })
  it('текст подсказки на месте', () => expect(WEAK_PIN_TEXT).toMatch(/простой PIN/))
})
