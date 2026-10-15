import { describe, expect, it } from 'vitest'
import { makeAnchor, anchorTarget } from './scrollAnchor.js'

describe('scrollAnchor', () => {
  it('запоминает отступ элемента от верха скроллера', () => {
    expect(makeAnchor('feed-1', 380, 60, 900)).toEqual({ anchor: 'feed-1', offset: 320, scrollTop: 900 })
  })

  it('ставит элемент на прежний отступ, даже если над ним вырос контент', () => {
    const snap = makeAnchor('feed-1', 380, 60, 900)
    // после возврата: скроллер наверху, карточка оказалась на 1300 px от верха
    expect(anchorTarget(snap, { scrollTop: 0, elTop: 1300, containerTop: 60 })).toBe(920)
    // уже на месте — сдвига нет
    expect(anchorTarget(snap, { scrollTop: 920, elTop: 380, containerTop: 60 })).toBe(920)
  })

  it('без элемента — прежний scrollTop, в пределах прокручиваемого', () => {
    const snap = makeAnchor('feed-x', 380, 60, 900)
    expect(anchorTarget(snap, { scrollTop: 0 })).toBe(900)
    expect(anchorTarget(snap, { scrollTop: 0, maxScroll: 400 })).toBe(400)
    expect(anchorTarget(snap, { scrollTop: 0, elTop: 0, containerTop: 60 })).toBe(0)
  })
})

describe('anchorTarget center (v8.9.8)', () => {
  const snap = { anchor: 'a', offset: 12, scrollTop: 0, center: true }
  it('карточка серединой в середину скроллера', () => {
    // скроллер 800, карточка 300 на 1000 px ниже верха → верх карточки на (800-300)/2 = 250
    expect(anchorTarget(snap, { scrollTop: 0, elTop: 1000, containerTop: 0, elHeight: 300, viewHeight: 800 })).toBe(750)
  })
  it('карточка выше скроллера — верхом на offset', () => {
    expect(anchorTarget(snap, { scrollTop: 0, elTop: 1000, containerTop: 0, elHeight: 900, viewHeight: 800 })).toBe(988)
  })
  it('без center — как раньше', () => {
    expect(anchorTarget({ ...snap, center: false }, { scrollTop: 0, elTop: 1000, containerTop: 0, elHeight: 300, viewHeight: 800 })).toBe(988)
  })
})
