// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useScrollAnchorRestore } from './useScrollAnchor.js'

describe('useScrollAnchorRestore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout'] })
  })
  afterEach(() => vi.useRealTimers())

  function setup(snap) {
    const ref = { current: document.createElement('div') }
    const onDone = vi.fn()
    renderHook(() => useScrollAnchorRestore(ref, snap, onDone))
    return onDone
  }

  it('обычный возврат подгоняет прокрутку ~1 с', () => {
    const onDone = setup({ anchor: null, offset: 0, scrollTop: 0 })
    vi.advanceTimersByTime(800)
    expect(onDone).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('якорь из пуша ждет дольше (snap.ms) — холодный старт', () => {
    const onDone = setup({ anchor: 'feed-w1', offset: 12, scrollTop: 0, ms: 2500 })
    vi.advanceTimersByTime(1500)
    expect(onDone).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1200)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('пуш/уведомление о реакции: по центру видимой части — вся карточка, а не шапка-якорь (fb_654fe23d)', () => {
    const rect = (top, height) => () => ({ top, height, bottom: top + height, left: 0, right: 390, width: 390 })
    const sc = document.createElement('div')
    Object.defineProperty(sc, 'clientHeight', { value: 700 })
    Object.defineProperty(sc, 'scrollHeight', { value: 5000 })
    Object.defineProperty(sc, 'scrollTop', { value: 0, writable: true })
    sc.getBoundingClientRect = rect(70, 700)
    const card = document.createElement('div')
    card.setAttribute('data-anchor-box', '')
    card.getBoundingClientRect = rect(600, 400)
    const head = document.createElement('button')
    head.setAttribute('data-anchor', 'feed-w1')
    head.getBoundingClientRect = rect(600, 50)
    card.append(head)
    sc.append(card)
    const bar = document.createElement('nav')
    bar.className = 'tabbar'
    bar.getBoundingClientRect = rect(700, 93)
    document.body.append(sc, bar)
    try {
      renderHook(() => useScrollAnchorRestore({ current: sc }, { anchor: 'feed-w1', offset: 12, scrollTop: 0, ms: 2500, center: true }))
      vi.advanceTimersByTime(20)
      // Видно 630 px (низ 70 px — под меню): карточка 400 px — с отступом (630 − 400) / 2 = 115 от верха.
      expect(sc.scrollTop).toBe(600 - 70 - 115)
    } finally {
      sc.remove(); bar.remove()
    }
  })
})
