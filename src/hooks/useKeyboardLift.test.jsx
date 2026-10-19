// @vitest-environment jsdom
// fb_17aad9f1: на iPhone «1 комментарий» с выезжающей клавиатурой уводил экран на две карточки вниз.
// Прокрутку .content ведет процесс интерфейса: iOS сам докручивает к полю, а страница еще видит старые
// координаты. Подъем обязан ставить абсолютную позицию (scrollTop + сдвиг из одного замера), чтобы
// повторный расчет на тех же «устаревших» координатах не удваивал сдвиг.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardLift } from './useKeyboardLift.js'

const rect = (top, bottom) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top })

describe('useKeyboardLift (fb_17aad9f1)', () => {
  let vv
  beforeEach(() => {
    vi.useFakeTimers()
    vv = Object.assign(new EventTarget(), { offsetTop: 0, height: 400 })
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
    delete window.visualViewport
  })

  it('повторный расчет на устаревших координатах не удваивает сдвиг', () => {
    document.body.innerHTML = '<div class="content"><div class="card"><form></form></div></div>'
    const scroller = document.querySelector('.content')
    const card = document.querySelector('.card')
    const form = document.querySelector('form')
    scroller.scrollTop = 100
    // Координаты не обновляются после прокрутки — как на iPhone, пока iOS сам двигает контейнер.
    card.getBoundingClientRect = () => rect(300, 900)
    form.getBoundingClientRect = () => rect(820, 880)
    scroller.scrollTo = vi.fn()
    const { result } = renderHook(() => useKeyboardLift({ current: form }))
    result.current()
    vi.advanceTimersByTime(130)
    vv.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(130)
    // Низ карточки (900) — над клавиатурой (400 − 12): сдвиг 512 от scrollTop 100, оба раза одна и та же цель.
    expect(scroller.scrollTo.mock.calls.map(([o]) => o.top)).toEqual([612, 612])
  })

  it('без клавиатуры — прежний подъем поля, тоже абсолютной позицией', () => {
    Object.defineProperty(window, 'innerHeight', { value: 420, configurable: true })
    document.body.innerHTML = '<div class="content"><div class="card"><form></form></div></div>'
    const scroller = document.querySelector('.content')
    const form = document.querySelector('form')
    scroller.scrollTop = 50
    document.querySelector('.card').getBoundingClientRect = () => rect(0, 700)
    form.getBoundingClientRect = () => rect(400, 440)
    scroller.scrollTo = vi.fn()
    const { result } = renderHook(() => useKeyboardLift({ current: form }))
    result.current()
    vi.advanceTimersByTime(130)
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 102 })
  })
})
