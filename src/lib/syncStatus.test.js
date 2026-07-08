import { describe, it, expect } from 'vitest'
import { syncBadgeState } from './syncStatus.js'

describe('syncBadgeState', () => {
  it('офлайн без очереди — иконка облака, без текста', () => {
    expect(syncBadgeState({ online: false, syncing: false })).toEqual({
      cls: 'offline',
      icon: 'offline',
      text: '',
      title: 'Офлайн',
    })
  })

  it('офлайн с очередью показывает счётчик', () => {
    expect(syncBadgeState({ online: false, syncing: false, pending: 3 })).toEqual({
      cls: 'offline',
      icon: 'offline',
      text: '3',
      title: 'Офлайн · 3 в очереди',
    })
  })

  it('идёт синхронизация — крутящийся кружок, приоритетнее очереди', () => {
    expect(syncBadgeState({ online: true, syncing: true, pending: 2 })).toEqual({
      cls: 'busy',
      icon: 'syncing',
      text: '',
      title: 'Синхронизация…',
    })
  })

  it('есть живая очередь — стрелка + число', () => {
    expect(syncBadgeState({ online: true, syncing: false, pending: 2 })).toEqual({
      cls: 'busy',
      icon: 'pending',
      text: '2',
      title: '2 не синхронизировано',
    })
  })

  it('всё отправлено — только галочка, без текста', () => {
    expect(syncBadgeState({ online: true, syncing: false, pending: 0, dead: 0 })).toEqual({
      cls: 'ok',
      icon: 'ok',
      text: '',
      title: 'Синхронизировано',
    })
  })

  // Ключевой регресс-кейс: dead-letter не должен выглядеть как «синхронизировано»,
  // пока на карточках висят жёлтые кружки (_dirty). Ждём предупреждающий бейдж.
  it('застрявшие изменения (dead-letter) — предупреждение, а не «синхронизировано»', () => {
    expect(syncBadgeState({ online: true, syncing: false, pending: 0, dead: 2 })).toEqual({
      cls: 'warn',
      icon: 'warn',
      text: '2 не отпр.',
      title: '2 не отправлено',
    })
  })

  it('живая очередь приоритетнее застрявшей', () => {
    expect(syncBadgeState({ online: true, syncing: false, pending: 1, dead: 5 })).toEqual({
      cls: 'busy',
      icon: 'pending',
      text: '1',
      title: '1 не синхронизировано',
    })
  })

  // Регресс-кейс авиарежима: navigator.onLine остаётся true, запрос падает по таймауту,
  // очередь пуста → раньше показывалась зелёная галочка «Синхронизировано». Ждём
  // предупреждение, а не «ок».
  it('сетевой сбой последнего прогона — облако (нет связи), а не «синхронизировано»', () => {
    expect(syncBadgeState({ online: true, syncing: false, pending: 0, dead: 0, netError: true })).toEqual({
      cls: 'warn',
      icon: 'offline',
      text: '',
      title: 'Нет связи — проверь сеть',
    })
  })

  it('идёт синхронизация приоритетнее сетевого сбоя', () => {
    expect(syncBadgeState({ online: true, syncing: true, netError: true })).toEqual({
      cls: 'busy',
      icon: 'syncing',
      text: '',
      title: 'Синхронизация…',
    })
  })

  it('офлайн приоритетнее сетевого сбоя', () => {
    expect(syncBadgeState({ online: false, syncing: false, netError: true })).toEqual({
      cls: 'offline',
      icon: 'offline',
      text: '',
      title: 'Офлайн',
    })
  })

  it('живая очередь приоритетнее сетевого сбоя', () => {
    expect(syncBadgeState({ online: true, syncing: false, pending: 2, netError: true })).toEqual({
      cls: 'busy',
      icon: 'pending',
      text: '2',
      title: '2 не синхронизировано',
    })
  })
})
