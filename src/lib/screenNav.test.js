import { describe, it, expect } from 'vitest'
import { transitionKind, isNested, swipeAxis, swipeBackBlocked, swipeCommits, textSelectionActive, edgeSwipeSupported, nextScreenStack, initialScreenStack,
  flickVelocity, gestureNow, pushSample, releaseVelocity, settleMotion, underlayShift, underlayDim } from './screenNav.js'

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

// fb_37f0c1a8: доезд после отпускания — со скоростью пальца, а не всегда за 180 мс.
describe('мягкий доезд свайпа', () => {
  it('скорость — по последним ~80 мс, а не по одному кадру', () => {
    const s = []
    pushSample(s, 0, 0)
    pushSample(s, 10, 16)
    pushSample(s, 20, 32)
    pushSample(s, 60, 48) // рывок в последнем кадре
    expect(releaseVelocity(s, 48)).toBeCloseTo(60 / 48)
    pushSample(s, 70, 200) // старые точки выпали из окна
    expect(s.length).toBe(2)
    expect(releaseVelocity(s, 200)).toBeCloseTo(10 / 152)
  })
  it('палец постоял перед отпусканием — броска нет; мало точек — ноль', () => {
    const s = pushSample(pushSample([], 0, 0), 100, 50)
    expect(releaseVelocity(s, 60)).toBeCloseTo(2)
    expect(releaseVelocity(s, 200)).toBe(0)
    expect(releaseVelocity(pushSample([], 5, 0), 0)).toBe(0)
    expect(releaseVelocity(pushSample(pushSample([], 0, 10), 50, 10), 10)).toBe(0) // одно время — не делим на ноль
  })
  it('медленно отпустил — доезд дольше и стартует плавно', () => {
    const slow = settleMotion(260, 0)
    expect(slow.ms).toBe(250)
    expect(slow.easing).toBe('cubic-bezier(0.25, 0, 0.35, 1)')
    const fast = settleMotion(260, 3)
    expect(fast.ms).toBeLessThan(slow.ms)
    expect(fast.ms).toBeGreaterThanOrEqual(180)
    // начальный наклон кривой (y1/x1) ≈ скорость пальца × время / путь
    const y1 = Number(fast.easing.match(/0\.25, ([\d.]+),/)[1])
    expect(y1 / 0.25).toBeCloseTo(Math.min(4, (3 * fast.ms) / 260), 1)
  })
  it('время в пределах, скорость от цели не ускоряет', () => {
    expect(settleMotion(2000, 0).ms).toBe(320)
    expect(settleMotion(10, 50).ms).toBe(180)
    expect(settleMotion(0, 1)).toEqual({ ms: 180, easing: 'cubic-bezier(0.25, 0, 0.35, 1)' })
    expect(settleMotion(-200, -2)).toEqual(settleMotion(200, 0))
  })
  it('подложка: левее на 30% и притемнена в начале, на месте и светлая в конце', () => {
    expect(underlayShift(0, 390)).toBe(-117)
    expect(underlayShift(195, 390)).toBe(-59)
    expect(underlayShift(390, 390)).toBe(-0)
    expect(underlayShift(500, 390)).toBe(-0)
    expect(underlayShift(10, 0)).toBe(0)
    expect(underlayDim(0, 390)).toBe(0.3)
    expect(underlayDim(195, 390)).toBe(0.15)
    expect(underlayDim(390, 390)).toBe(0)
    expect(underlayDim(10, 0)).toBe(0)
  })
})

// Видео владельца 23.10: короткий бросок с притормозившим концом возвращал экран — решаем по пику.
it('flickVelocity — пик в окне; палец постоял — броска нет', () => {
  const s = []
  for (const [x, t] of [[0, 0], [40, 16], [90, 32], [100, 48], [104, 64]]) pushSample(s, x, t)
  expect(releaseVelocity(s, 64)).toBeLessThan(flickVelocity(s, 64))
  expect(flickVelocity(s, 64)).toBeCloseTo(50 / 16)
  expect(flickVelocity(s, 300)).toBe(0)
  expect(flickVelocity([], 0)).toBe(0)
})

// fb_e1583b4f: короткий бросок засчитывается; часы жеста — свои, не timeStamp события.
it('swipeCommits — бросок от 0,3 px/мс на 30 px; gestureNow — performance.now', () => {
  expect(swipeCommits(50, 0.35, 390)).toBe(true)
  expect(swipeCommits(25, 2, 390)).toBe(false)
  expect(swipeCommits(50, 0.2, 390)).toBe(false)
  expect(typeof gestureNow({ timeStamp: 5 })).toBe('number')
})
