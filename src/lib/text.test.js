import { describe, it, expect } from 'vitest'
import { onlyDigits } from './text.js'

describe('onlyDigits', () => {
  it('оставляет только цифры', () => {
    expect(onlyDigits('a1b2c3')).toBe('123')
    expect(onlyDigits('12-34')).toBe('1234')
  })
  it('обрезает до max (по умолчанию 4 — длина PIN)', () => {
    expect(onlyDigits('123456')).toBe('1234')
    expect(onlyDigits('123456', 6)).toBe('123456')
  })
  it('max=null → без обрезки', () => {
    expect(onlyDigits('12345678', null)).toBe('12345678')
  })
  it('пустой/undefined/нецифровой → пусто', () => {
    expect(onlyDigits('')).toBe('')
    expect(onlyDigits(undefined)).toBe('')
    expect(onlyDigits('abc')).toBe('')
  })
})
