// @vitest-environment jsdom
// Лист таймера отдыха (покрытие тестами 20.10.2026: было 70 % строк). Через WorkoutScreen
// проверены старт/стоп/пресеты; здесь — фазы на кольце, настройки сигнала и экрана, «Убрать
// таймер», вибро не показываем на iPhone (там его нет).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import RestSheet from './RestSheet.jsx'

const SETTINGS = { on: true, sound: 'mix', vibrate: true, wake: true, push: true }
let handlers
function renderSheet(props = {}) {
  handlers = {
    onStart: vi.fn(), onChoose: vi.fn(), onAdjust: vi.fn(), onStop: vi.fn(),
    onSettings: vi.fn(), onHide: vi.fn(), onClose: vi.fn(),
  }
  return render(<RestSheet state={{ phase: 'idle' }} run={null} idleSec={90} settings={SETTINGS} exerciseName="Жим" {...handlers} {...props} />)
}

beforeEach(() => {
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 14)', configurable: true })
  window.requestAnimationFrame = (fn) => { fn(); return 1 }
  window.matchMedia = vi.fn(() => ({ matches: true }))
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => vi.clearAllMocks())

describe('RestSheet', () => {
  it('отдых не идет: длительность, «Старт», ±15 с', () => {
    renderSheet()
    expect(screen.getByRole('timer')).toHaveTextContent('1:30')
    expect(screen.getByRole('timer')).toHaveTextContent('отдых не идет')
    fireEvent.click(screen.getByRole('button', { name: 'Старт' }))
    expect(handlers.onStart).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Плюс 15 секунд' }))
    fireEvent.click(screen.getByRole('button', { name: 'Минус 15 секунд' }))
    expect(handlers.onAdjust.mock.calls).toEqual([[15], [-15]])
  })

  it('идет: «Стоп» и «из N»; пресет текущей длины отмечен', () => {
    renderSheet({ state: { phase: 'run', leftMs: 45_000, progress: 0.5 }, run: { durMs: 120_000, exerciseName: 'Присед' } })
    expect(screen.getByRole('timer')).toHaveTextContent('из 2:00')
    expect(screen.getByText('Присед')).toBeInTheDocument() // имя из запуска, а не активной карточки
    fireEvent.click(screen.getByRole('button', { name: 'Стоп' }))
    expect(handlers.onStop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '2:00', pressed: true })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '3:00' }))
    expect(handlers.onChoose).toHaveBeenCalledWith(180)
  })

  it('время вышло: «0:00», «пора к подходу», «Заново»', () => {
    renderSheet({ state: { phase: 'done' } })
    expect(screen.getByRole('timer')).toHaveTextContent('0:00')
    expect(screen.getByRole('timer')).toHaveTextContent('пора к подходу')
    fireEvent.click(screen.getByRole('button', { name: 'Заново' }))
    expect(handlers.onStart).toHaveBeenCalled()
  })

  it('«Сигнал и экран»: звук, вибро, экран, пуш, «Убрать таймер»; раскрытие прокручивает к блоку', () => {
    renderSheet()
    const details = document.querySelector('details.rest-more') // лист — в портале
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' })
    expect(screen.getByText(/В беззвучном режиме iPhone промолчит/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Всегда' }))
    expect(handlers.onSettings).toHaveBeenLastCalledWith({ sound: 'loud' })
    fireEvent.click(screen.getByRole('switch', { name: 'Вибрация' }))
    expect(handlers.onSettings).toHaveBeenLastCalledWith({ vibrate: false })
    fireEvent.click(screen.getByRole('switch', { name: /Не гасить экран/ }))
    expect(handlers.onSettings).toHaveBeenLastCalledWith({ wake: false })
    fireEvent.click(screen.getByRole('switch', { name: /Пуш, если свернуто/ }))
    expect(handlers.onSettings).toHaveBeenLastCalledWith({ push: false })
    fireEvent.click(screen.getByRole('button', { name: 'Убрать таймер' }))
    expect(handlers.onHide).toHaveBeenCalled()
    details.open = false
    fireEvent(details, new Event('toggle')) // закрытие не прокручивает
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('iPhone — переключателя вибрации нет (Safari не умеет)', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', configurable: true })
    renderSheet()
    expect(screen.queryByRole('switch', { name: 'Вибрация' })).toBeNull()
  })
})
