import { describe, it, expect } from 'vitest'
import { transitionKind, isNested, swipeAxis, swipeCommits, edgeSwipeSupported, nextScreenStack, initialScreenStack } from './screenNav.js'

describe('стек возврата', () => {
  it('сохраняет предков и убирает закрытые дочерние экраны', () => {
    const stack = nextScreenStack(nextScreenStack(['profile'], 'appearance'), 'notif')
    expect(stack).toEqual(['profile', 'appearance', 'notif'])
    expect(nextScreenStack(stack, 'appearance')).toEqual(['profile', 'appearance'])
    expect(nextScreenStack(stack, 'feed')).toEqual(['feed'])
  })
  it('холодный вход на вложенный экран имеет родителя', () => {
    expect(initialScreenStack('appearance')).toEqual(['profile', 'appearance'])
    expect(initialScreenStack('notif')).toEqual(['home', 'notif'])
    expect(initialScreenStack('feed')).toEqual(['feed'])
  })
})

describe('transitionKind', () => {
  it('вкладка ↔ вкладка и профиль — fade', () => {
    expect(transitionKind('home', 'feed')).toBe('fade')
    expect(transitionKind('feed', 'profile')).toBe('fade')
  })
  it('вглубь — push, назад — pop (кейс видео: Настройки ↔ Что нового)', () => {
    expect(transitionKind('profile', 'whatsnew')).toBe('push')
    expect(transitionKind('whatsnew', 'profile')).toBe('pop')
    expect(transitionKind('feed', 'member')).toBe('push')
    expect(transitionKind('member', 'feed')).toBe('pop')
  })
  it('между вложенными — push', () => {
    expect(transitionKind('notif', 'member')).toBe('push')
  })
  it('все экраны с кнопкой «Назад» считаются вложенными', () => {
    for (const t of ['notif', 'member', 'freshness', 'achievements', 'admin', 'myex', 'whatsnew', 'appearance']) {
      expect(isNested(t)).toBe(true)
    }
    for (const t of ['home', 'history', 'feed', 'progress', 'profile']) expect(isNested(t)).toBe(false)
  })
})

describe('swipeAxis', () => {
  it('рано судить в пределах 8 px', () => expect(swipeAxis(5, 3)).toBeNull())
  it('вправо — наш жест', () => expect(swipeAxis(30, 10)).toBe('x'))
  it('вертикаль и влево — не наш', () => {
    expect(swipeAxis(10, 30)).toBe('y')
    expect(swipeAxis(-30, 2)).toBe('y')
    expect(swipeAxis(20, 19)).toBe('y') // диагональ — отдаем прокрутке
  })
})

describe('swipeCommits', () => {
  it('треть ширины — назад', () => {
    expect(swipeCommits(140, 0, 390)).toBe(true)
    expect(swipeCommits(120, 0.1, 390)).toBe(false)
  })
  it('быстрый бросок — назад даже с короткого', () => {
    expect(swipeCommits(60, 0.8, 390)).toBe(true)
    expect(swipeCommits(30, 0.8, 390)).toBe(false)
  })
  it('вернул палец назад — не срабатывает', () => expect(swipeCommits(0, 1, 390)).toBe(false))
})

describe('edgeSwipeSupported', () => {
  it('только iOS на экране Домой', () => {
    expect(edgeSwipeSupported({ isIOS: true, standalone: true })).toBe(true)
    expect(edgeSwipeSupported({ isIOS: true, standalone: false })).toBe(false)
    expect(edgeSwipeSupported({ isIOS: false, standalone: true })).toBe(false)
  })
})
