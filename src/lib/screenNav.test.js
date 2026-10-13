import { describe, it, expect } from 'vitest'
import { transitionKind, isNested, swipeAxis, swipeBackBlocked, swipeCommits, textSelectionActive, edgeSwipeSupported, nextScreenStack, initialScreenStack } from './screenNav.js'

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
    for (const t of ['notif', 'member', 'freshness', 'achievements', 'admin', 'myex', 'whatsnew', 'appearance', 'pushset']) {
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
  it('от середины — горизонталь должна преобладать сильнее (v7.1.7)', () => {
    expect(swipeAxis(30, 10, false)).toBe('x')
    expect(swipeAxis(30, 22, false)).toBe('y') // у края это было бы «назад»
    expect(swipeAxis(30, 22, true)).toBe('x')
  })
})

describe('swipeBackBlocked (жест от середины, v7.1.7)', () => {
  // Узел-заглушка: style — вычисленный стиль, остальное — геометрия прокрутки.
  const node = (parent, { tag = 'div', style = {}, ...box } = {}) => ({
    nodeType: 1, parentElement: parent, style,
    scrollWidth: 0, clientWidth: 0, scrollLeft: 0, ...box,
    matches: (sel) => sel.split(',').map((x) => x.trim()).includes(tag),
  })
  const getStyle = (el) => ({ overflowX: 'visible', touchAction: 'auto', ...el.style })
  const stop = node(null)

  it('обычный текст и кнопки — жест наш', () => {
    expect(swipeBackBlocked(node(node(stop)), stop, getStyle)).toBe(false)
  })
  it('поле и ползунок ведут палец сами', () => {
    expect(swipeBackBlocked(node(stop, { tag: 'input' }), stop, getStyle)).toBe(true)
    expect(swipeBackBlocked(node(node(stop, { tag: '[data-no-swipe-back]' })), stop, getStyle)).toBe(true)
  })
  it('ручка перетаскивания (touch-action: none) — не наш', () => {
    expect(swipeBackBlocked(node(stop, { style: { touchAction: 'none' } }), stop, getStyle)).toBe(true)
  })
  it('ряд чипов: пролистан — листаем его, у левого края — назад', () => {
    const row = (scrollLeft) => node(stop, { style: { overflowX: 'auto' }, scrollWidth: 600, clientWidth: 300, scrollLeft })
    expect(swipeBackBlocked(node(row(40)), stop, getStyle)).toBe(true)
    expect(swipeBackBlocked(node(row(0)), stop, getStyle)).toBe(false)
  })
  it('сам скроллер экрана и выше не смотрим', () => {
    const outer = node(null, { tag: 'input' })
    const box = node(outer)
    expect(swipeBackBlocked(node(box), box, getStyle)).toBe(false)
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

describe('textSelectionActive (v7.5.5)', () => {
  it('выделен текст — да; пусто, свернуто или нет API — нет', () => {
    expect(textSelectionActive({ isCollapsed: false, toString: () => 'кардио' })).toBe(true)
    expect(textSelectionActive({ isCollapsed: true, toString: () => '' })).toBe(false)
    expect(textSelectionActive({ isCollapsed: false, toString: () => '  ' })).toBe(false)
    expect(textSelectionActive(null)).toBe(false)
  })
})
