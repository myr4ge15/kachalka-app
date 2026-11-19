// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFieldViewport } from './useFieldViewport.js'

describe('useFieldViewport', () => {
  let view, field, scope, scroll, focus
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('innerHeight', 600)
    view = Object.assign(new EventTarget(), { height: 600, offsetTop: 0 })
    vi.stubGlobal('visualViewport', view)
    document.body.innerHTML = '<div class="content"><div class="workout-screen"><input><input><button>+</button><div class="wk-save-bar"></div></div></div>'
    scope = document.querySelector('.workout-screen')
    field = scope.querySelector('input')
    scroll = document.querySelector('.content')
    scroll.getBoundingClientRect = () => ({ top: 0, bottom: 600 })
    field.getBoundingClientRect = () => ({ top: 300, bottom: 344 })
    scope.lastElementChild.getBoundingClientRect = () => ({ top: 310 })
    focus = renderHook(useFieldViewport).result.current
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren() })
  function start(target = field) { target.focus(); focus({ currentTarget: scope, target }); vi.advanceTimersByTime(20) }
  function resize(height) { view.height = height; view.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(20) }
  it('не трогает обычный фокус; учитывает и полосу сохранения, и видимый край', () => {
    start(); expect(scroll.scrollTop).toBe(0)
    resize(420); expect(scope.dataset.fieldViewport).toBe('open'); expect(scroll.scrollTop).toBe(40)
    resize(280); expect(scroll.scrollTop).toBe(110)
    resize(600); expect(scope.dataset.fieldViewport).toBeUndefined()
  })
  it('удерживает исходную высоту при смене поля и снимает стили после ухода', () => {
    start(); vi.stubGlobal('innerHeight', 300); resize(300)
    const second = scope.querySelectorAll('input')[1]; start(second)
    expect(scope.dataset.fieldViewport).toBe('short')
    second.blur(); resize(260); vi.advanceTimersByTime(300)
    expect(scope.style.getPropertyValue('--field-bottom')).toBe('')
    resize(200); expect(scope.dataset.fieldViewport).toBeUndefined()
  })
  it('лист: применяет верхний сдвиг и нижний отступ даже без внутреннего скроллера', () => {
    scope.className = 'sheet'; scroll.className = ''; view.offsetTop = 20
    start(); resize(280)
    expect(scope.style.getPropertyValue('--field-top')).toBe('20px')
    expect(scope.style.getPropertyValue('--field-bottom')).toBe('300px')
    scroll.className = 'sheet-scroll'; start(); expect(scroll.scrollTop).toBe(50)
  })
  it('игнорирует кнопки, поля портала и поля вне формы; работает без visualViewport', () => {
    start(scope.querySelector('button')); focus({ currentTarget: field, target: scope.querySelector('input + input') })
    scope.className = ''; start(); resize(280); expect(scope.dataset.fieldViewport).toBeUndefined()
    scope.className = 'workout-screen'; scope.lastElementChild.remove(); vi.stubGlobal('visualViewport', undefined)
    start(); vi.stubGlobal('innerHeight', 300); window.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(20)
    expect(scroll.scrollTop).toBe(50)
  })
})
