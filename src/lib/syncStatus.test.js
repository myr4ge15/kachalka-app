import { describe, it, expect } from 'vitest'
import { syncBadgeState } from './syncStatus.js'

describe('syncBadgeState', () => {
  it('офлайн без очереди', () => {
    expect(syncBadgeState({ online: false, syncing: false })).toEqual({
      cls: 'offline',
      text: 'офлайн',
    })
  })

  it('офлайн с очередью показывает счётчик', () => {
    expect(syncBadgeState({ online: false, syncing: false, pending: 3 })).toEqual({
      cls: 'offline',
      text: 'офлайн · 3 в очереди',
    })
  })

  it('идёт синхронизация — приоритетнее очереди', () => {
    expect(syncBadgeState({ online: true, syncing: true, pending: 2 })).toEqual({
      cls: 'busy',
      text: 'синхронизация…',
    })
  })

  it('есть живая очередь', () => {
    expect(syncBadgeState({ online: true, syncing: false, pending: 2 })).toEqual({
      cls: 'busy',
      text: '2 не синхр.',
    })
  })

  it('всё отправлено', () => {
    expect(syncBadgeState({ online: true, syncing: false, pending: 0, dead: 0 })).toEqual({
      cls: 'ok',
      text: 'синхронизировано',
    })
  })

  // Ключевой регресс-кейс: dead-letter не должен выглядеть как «синхронизировано»,
  // пока на карточках висят жёлтые кружки (_dirty). Ждём предупреждающий бейдж.
  it('застрявшие изменения (dead-letter) — предупреждение, а не «синхронизировано»', () => {
    expect(syncBadgeState({ online: true, syncing: false, pending: 0, dead: 2 })).toEqual({
      cls: 'warn',
      text: '2 не отправлено',
    })
  })

  it('живая очередь приоритетнее застрявшей', () => {
    expect(syncBadgeState({ online: true, syncing: false, pending: 1, dead: 5 })).toEqual({
      cls: 'busy',
      text: '1 не синхр.',
    })
  })
})
