import { describe, it, expect } from 'vitest'
import { ROSTER_FIELDS, pickRosterShape, planRosterWrite } from './roster.js'

const DIMA = { id: 'u1', name: 'Дима', avatar_url: null, sort_order: 1, sex: 'm' }
const OLYA = { id: 'u2', name: 'Оля', avatar_url: 'a.png', sort_order: 2, sex: 'f' }

describe('pickRosterShape', () => {
  it('оставляет только поля белого списка', () => {
    const out = pickRosterShape({ ...OLYA, pin_hash: 'x', pin_salt: 'y', role: 'admin', updated_at: 'T' })
    expect(out).toEqual(OLYA)
  })
  it('НЕ добавляет отсутствующие ключи (иначе мерж затрёт кэш пачкой undefined)', () => {
    const out = pickRosterShape({ id: 'u1', name: 'Дима' })
    expect(Object.keys(out)).toEqual(['id', 'name'])
    expect('sex' in out).toBe(false)
  })
  it('пустой вход → пустой объект', () => {
    expect(pickRosterShape(null)).toEqual({})
    expect(pickRosterShape(undefined)).toEqual({})
  })
  it('белый список содержит sex — поле, потерянное в инциденте 29.07.2026', () => {
    expect(ROSTER_FIELDS).toContain('sex')
  })
})

describe('planRosterWrite', () => {
  it('выборка БЕЗ sex не обнуляет пол в кэше (кейс инцидента 29.07.2026)', () => {
    // Ровно то, что делал экран входа: select('id, name, avatar_url, sort_order').
    const incoming = [
      { id: 'u1', name: 'Дима', avatar_url: null, sort_order: 1 },
      { id: 'u2', name: 'Оля', avatar_url: 'a.png', sort_order: 2 },
    ]
    const { puts, deleteIds } = planRosterWrite([DIMA, OLYA], incoming)
    expect(puts).toEqual([DIMA, OLYA])
    expect(deleteIds).toEqual([])
  })

  it('явный null во входящей строке пол СБРАСЫВАЕТ (присутствующий ключ побеждает)', () => {
    const { puts } = planRosterWrite([OLYA], [{ ...OLYA, sex: null }])
    expect(puts[0].sex).toBe(null)
  })

  it('обновляет изменённые поля и сохраняет непришедшие', () => {
    const { puts } = planRosterWrite([OLYA], [{ id: 'u2', name: 'Ольга' }])
    expect(puts).toEqual([{ ...OLYA, name: 'Ольга' }])
  })

  it('новая учётка добавляется целиком', () => {
    const { puts, deleteIds } = planRosterWrite([DIMA], [DIMA, OLYA])
    expect(puts).toEqual([DIMA, OLYA])
    expect(deleteIds).toEqual([])
  })

  it('id, которого больше нет в выборке, попадает в deleteIds', () => {
    const { puts, deleteIds } = planRosterWrite([DIMA, OLYA], [DIMA])
    expect(puts).toEqual([DIMA])
    expect(deleteIds).toEqual(['u2'])
  })

  it('пустой список ростер НЕ затирает (иначе сбой прав лишает офлайн-входа)', () => {
    expect(planRosterWrite([DIMA, OLYA], [])).toEqual({ puts: [], deleteIds: [] })
    expect(planRosterWrite([DIMA, OLYA], null)).toEqual({ puts: [], deleteIds: [] })
  })

  it('строки без id игнорируются с обеих сторон', () => {
    const { puts, deleteIds } = planRosterWrite([DIMA, { name: 'мусор' }], [OLYA, { name: 'мусор' }])
    expect(puts).toEqual([OLYA])
    expect(deleteIds).toEqual(['u1'])
  })

  it('легаси-поля из старой общей базы не переезжают в кэш', () => {
    const legacy = { ...DIMA, pin_hash: 'h', pin_salt: 's' }
    const { puts } = planRosterWrite([legacy], [{ id: 'u1', name: 'Дима' }])
    expect(puts[0]).toEqual(DIMA)
  })

  it('пустой кэш (первый вход) → пишем как пришло', () => {
    const { puts, deleteIds } = planRosterWrite([], [DIMA])
    expect(puts).toEqual([DIMA])
    expect(deleteIds).toEqual([])
    expect(planRosterWrite(null, [DIMA]).puts).toEqual([DIMA])
  })
})
