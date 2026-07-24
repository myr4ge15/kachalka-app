import { describe, it, expect } from 'vitest'
import { canShowFab, FAB_TABS } from './quickAdd.js'

describe('canShowFab', () => {
  it('показывается на Главной и в хабе «Тренировки»', () => {
    for (const tab of FAB_TABS) {
      expect(canShowFab({ tab })).toBe(true)
    }
    expect(FAB_TABS).toEqual(['home', 'history'])
  })

  it('скрыт на экранах чтения (Лента, Прогресс)', () => {
    expect(canShowFab({ tab: 'feed' })).toBe(false)
    expect(canShowFab({ tab: 'progress' })).toBe(false)
  })

  it('скрыт на вложенных роутах', () => {
    for (const tab of ['profile', 'notif', 'admin', 'freshness', 'myex', 'achievements']) {
      expect(canShowFab({ tab })).toBe(false)
    }
  })

  it('busy перевешивает вкладку: композер/экспорт открыт → кнопки нет', () => {
    expect(canShowFab({ tab: 'history', busy: true })).toBe(false)
    // busy приходит только из хаба «Тренировки», но правило не зависит от вкладки
    expect(canShowFab({ tab: 'home', busy: true })).toBe(false)
  })

  it('краевые: неизвестная вкладка и пустой вызов', () => {
    expect(canShowFab({ tab: 'workout' })).toBe(false)
    expect(canShowFab({ tab: undefined })).toBe(false)
    expect(canShowFab()).toBe(false)
  })
})
