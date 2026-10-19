import { describe, it, expect } from 'vitest'
import { syncBadgeHelp, syncBadgeQuiet, syncBadgeState, syncErrorText } from './syncStatus.js'

describe('syncBadgeState', () => {
  it('офлайн без очереди — иконка облака, без текста', () => {
    expect(syncBadgeState({ online: false, syncing: false })).toEqual({
      cls: 'offline',
      icon: 'offline',
      text: '',
      title: 'Офлайн',
    })
  })

  it('офлайн с очередью показывает счетчик', () => {
    expect(syncBadgeState({ online: false, syncing: false, pending: 3 })).toEqual({
      cls: 'offline',
      icon: 'offline',
      text: '3',
      title: 'Офлайн · 3 в очереди',
    })
  })

  it('идет синхронизация — крутящийся кружок, приоритетнее очереди', () => {
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

  it('все отправлено — только галочка, без текста', () => {
    expect(syncBadgeState({ online: true, syncing: false, pending: 0, dead: 0 })).toEqual({
      cls: 'ok',
      icon: 'ok',
      text: '',
      title: 'Синхронизировано',
    })
  })

  // Ключевой регресс-кейс: dead-letter не должен выглядеть как «синхронизировано»,
  // пока на карточках висят желтые кружки (_dirty). Ждем предупреждающий бейдж.
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

  // Регресс-кейс авиарежима: navigator.onLine остается true, запрос падает по таймауту,
  // очередь пуста → раньше показывалась зеленая галочка «Синхронизировано». Ждем
  // предупреждение, а не «ок».
  it('сетевой сбой последнего прогона — розовое облако (нет связи), а не «синхронизировано»', () => {
    expect(syncBadgeState({ online: true, syncing: false, pending: 0, dead: 0, netError: true })).toEqual({
      cls: 'offline',
      icon: 'offline',
      text: '',
      title: 'Нет связи — проверь сеть',
    })
  })

  it('идет синхронизация приоритетнее сетевого сбоя', () => {
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

describe('syncBadgeQuiet — бейдж только при проблеме (аудит 16.10)', () => {
  const q = (s) => syncBadgeQuiet(syncBadgeState(s), s)
  it('синхронизировано и фоновый опрос — скрыт', () => {
    expect(q({ online: true, syncing: false })).toBe(true)
    expect(q({ online: true, syncing: true, pending: 0 })).toBe(true)
  })
  it('офлайн, очередь, застряло, нет связи, отправка очереди — виден', () => {
    expect(q({ online: false, syncing: false })).toBe(false)
    expect(q({ online: true, syncing: false, pending: 2 })).toBe(false)
    expect(q({ online: true, syncing: true, pending: 2 })).toBe(false)
    expect(q({ online: true, syncing: false, dead: 1 })).toBe(false)
    expect(q({ online: true, syncing: false, netError: true })).toBe(false)
  })
})

describe('syncBadgeHelp — что не так, по тапу на бейдж (fb_dbdf463c)', () => {
  const help = (st, extra = {}) => syncBadgeHelp(syncBadgeState(st), { ...st, ...extra })

  it('офлайн — без действия, с очередью', () => {
    expect(help({ online: false, pending: 2 })).toMatchObject({ title: 'Нет сети', action: null })
    expect(help({ online: false, pending: 2 }).sub).toContain('2')
  })

  it('очередь — «Повторить», застрявшие — в Профиль', () => {
    expect(help({ online: true, pending: 3 })).toMatchObject({ action: 'retry' })
    expect(help({ online: true, dead: 1 })).toMatchObject({ title: 'Не отправилось: 1', action: 'profile' })
  })

  it('сбой прогона — причина из lastError и «Повторить»', () => {
    const h = help({ online: true, netError: true }, { lastError: 'Сессия завершена на сервере — войди заново' })
    expect(h).toMatchObject({ action: 'retry', sub: 'Сессия завершена на сервере — войди заново' })
  })

  it('в норме подсказки нет', () => {
    expect(help({ online: true })).toBeNull()
  })
})

describe('syncErrorText', () => {
  it('русский текст — как есть, технический — по-человечески', () => {
    expect(syncErrorText('Нет входа на сервере')).toBe('Нет входа на сервере')
    expect(syncErrorText('TimeoutError: timed out after 15000ms')).toMatch(/не ответил вовремя/)
    expect(syncErrorText('TypeError: Load failed')).toMatch(/Нет связи/)
    expect(syncErrorText('')).toMatch(/Проверь интернет/)
    expect(syncErrorText('x'.repeat(200)).length).toBeLessThan(110)
  })
})
