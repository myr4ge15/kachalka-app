import { describe, it, expect } from 'vitest'
import { BACKOFF_MAX_MS, backoffDelay, nextFailureCount } from './backoff.js'

describe('backoffDelay', () => {
  it('нет сбоев → базовый интервал без изменений', () => {
    expect(backoffDelay(20000, 0)).toBe(20000)
  })

  it('растёт экспоненциально с числом сбоев', () => {
    expect(backoffDelay(20000, 1)).toBe(40000)
    expect(backoffDelay(20000, 2)).toBe(80000)
    expect(backoffDelay(20000, 3)).toBe(160000)
  })

  it('не превышает потолок', () => {
    expect(backoffDelay(20000, 100)).toBe(BACKOFF_MAX_MS)
    expect(backoffDelay(60000, 50, 300000)).toBe(300000)
  })

  it('некорректный/отрицательный счётчик трактуется как «сбоев нет»', () => {
    expect(backoffDelay(20000, -3)).toBe(20000)
    expect(backoffDelay(20000, NaN)).toBe(20000)
    expect(backoffDelay(20000, undefined)).toBe(20000)
  })
})

describe('nextFailureCount', () => {
  it('успех сбрасывает счётчик в 0', () => {
    expect(nextFailureCount(5, true)).toBe(0)
    expect(nextFailureCount(0, true)).toBe(0)
  })

  it('сбой увеличивает счётчик на 1', () => {
    expect(nextFailureCount(0, false)).toBe(1)
    expect(nextFailureCount(3, false)).toBe(4)
  })

  it('пропуск прогона (undefined) не меняет счётчик', () => {
    expect(nextFailureCount(2, undefined)).toBe(2)
    expect(nextFailureCount(0, undefined)).toBe(0)
    expect(nextFailureCount(2, null)).toBe(2)
  })

  it('битый предыдущий счётчик нормализуется к 0', () => {
    expect(nextFailureCount(undefined, false)).toBe(1)
    expect(nextFailureCount(-2, false)).toBe(1)
    expect(nextFailureCount(NaN, false)).toBe(1)
  })
})
