import { describe, it, expect } from 'vitest'
import { fabState } from './quickAdd.js'

describe('fabState', () => {
  it('по умолчанию кнопка активна — на любой вкладке и вложенном роуте', () => {
    expect(fabState()).toBe('on')
    expect(fabState({ busy: false })).toBe('on')
  })

  it('занятый хаб (композер/экспорт) — кнопка утоплена, а не скрыта', () => {
    expect(fabState({ busy: true })).toBe('sunk')
  })
})
