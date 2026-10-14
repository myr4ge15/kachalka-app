import { describe, it, expect } from 'vitest'
import { trayAdd, trayReplace } from './scannerTray.js'

const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }
describe('scannerTray', () => {
  it('добавляет новое в конец, повтор не дублирует', () => {
    expect(trayAdd([a], b)).toEqual({ tray: [a, b], added: true })
    const same = [a]
    expect(trayAdd(same, { id: 'a' })).toEqual({ tray: same, added: false })
    expect(trayAdd(same, null).added).toBe(false)
  })
  it('меняет последнее на месте; выбранное уже есть — просто убирает угаданное', () => {
    expect(trayReplace([a, b], 'a', c)).toEqual([c, b])
    expect(trayReplace([a, b], 'b', a)).toEqual([a])
    expect(trayReplace([a], 'x', c)).toEqual([a, c])
    expect(trayReplace([a], 'a', a)).toEqual([a])
  })
})
