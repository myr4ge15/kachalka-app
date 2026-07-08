import { describe, it, expect } from 'vitest'
import { maxUpdatedAt, changedSince, rosterSignature } from './pullWatermark.js'

const T1 = '2026-07-08T10:00:00.000000+00:00'
const T2 = '2026-07-08T10:00:00.500000+00:00' // на полсекунды позже T1
const T3 = '2026-07-08T11:00:00.000000+00:00'

describe('maxUpdatedAt', () => {
  it('находит максимум по updated_at', () => {
    expect(maxUpdatedAt([{ updated_at: T1 }, { updated_at: T3 }, { updated_at: T2 }])).toBe(T3)
  })
  it('пустой массив / отсутствие поля → null', () => {
    expect(maxUpdatedAt([])).toBe(null)
    expect(maxUpdatedAt(null)).toBe(null)
    expect(maxUpdatedAt([{ id: 'a' }, { id: 'b' }])).toBe(null)
  })
  it('игнорирует строки без updated_at, но берёт максимум из валидных', () => {
    expect(maxUpdatedAt([{ updated_at: T1 }, { id: 'x' }, { updated_at: T3 }])).toBe(T3)
  })
  it('различает микросекунды (лексикографически = хронологически)', () => {
    expect(maxUpdatedAt([{ updated_at: T1 }, { updated_at: T2 }])).toBe(T2)
  })
  it('кастомный ключ', () => {
    expect(maxUpdatedAt([{ ts: T1 }, { ts: T3 }], 'ts')).toBe(T3)
  })
})

describe('changedSince', () => {
  it('первый прогон (watermark пуст) → всегда качаем', () => {
    expect(changedSince(T1, null)).toBe(true)
    expect(changedSince(null, null)).toBe(true)
    expect(changedSince(null, '')).toBe(true)
  })
  it('сервер новее watermark → изменилось', () => {
    expect(changedSince(T3, T1)).toBe(true)
    expect(changedSince(T2, T1)).toBe(true) // микросекунды
  })
  it('сервер не новее watermark → не изменилось', () => {
    expect(changedSince(T1, T1)).toBe(false) // равно
    expect(changedSince(T1, T3)).toBe(false) // старее
  })
  it('сервер пуст при непустом watermark → нечего тянуть', () => {
    expect(changedSince(null, T1)).toBe(false)
  })
})

describe('rosterSignature', () => {
  it('стабильна к порядку строк', () => {
    const a = rosterSignature([{ id: 'u2', updated_at: T2 }, { id: 'u1', updated_at: T1 }])
    const b = rosterSignature([{ id: 'u1', updated_at: T1 }, { id: 'u2', updated_at: T2 }])
    expect(a).toBe(b)
  })
  it('меняется при правке (updated_at вырос)', () => {
    const before = rosterSignature([{ id: 'u1', updated_at: T1 }])
    const after = rosterSignature([{ id: 'u1', updated_at: T3 }])
    expect(before).not.toBe(after)
  })
  it('меняется при удалении строки (id пропал), хотя max не вырос', () => {
    const before = rosterSignature([{ id: 'u1', updated_at: T3 }, { id: 'u2', updated_at: T1 }])
    const after = rosterSignature([{ id: 'u1', updated_at: T3 }]) // u2 удалён, max тот же T3
    expect(before).not.toBe(after)
  })
  it('меняется при появлении новой строки', () => {
    const before = rosterSignature([{ id: 'u1', updated_at: T1 }])
    const after = rosterSignature([{ id: 'u1', updated_at: T1 }, { id: 'u2', updated_at: T1 }])
    expect(before).not.toBe(after)
  })
  it('одинакова при неизменном окне', () => {
    const rows = [{ id: 'u1', updated_at: T1 }, { id: 'u2', updated_at: T2 }]
    expect(rosterSignature(rows)).toBe(rosterSignature([...rows]))
  })
  it('пустое окно → стабильная сигнатура', () => {
    expect(rosterSignature([])).toBe(rosterSignature([]))
    expect(rosterSignature([])).not.toBe(rosterSignature([{ id: 'u1', updated_at: T1 }]))
  })
})
