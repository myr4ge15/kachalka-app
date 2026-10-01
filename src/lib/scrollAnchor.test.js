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
