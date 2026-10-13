// @vitest-environment jsdom
//
// Подсказка «Как выполнять» (v8.0.0): порядок блоков, смена кадров с паузой,
// reduced-motion, сбой загрузки кадра и остановка смены после закрытия.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import TechniqueSheet from './TechniqueSheet.jsx'

function mockReducedMotion(reduce) {
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: reduce && q.includes('reduce'), media: q,
    addEventListener() {}, removeEventListener() {},
  }))
}

afterEach(() => {
  vi.useRealTimers()
  delete window.matchMedia
})

describe('TechniqueSheet', () => {
  it('показывает разделы по порядку и источник рисунков', async () => {
    render(<TechniqueSheet slug="bench-press" name="Жим лежа со штангой" onClose={vi.fn()} />)
    expect(await screen.findByText('Как выполнять')).toBeInTheDocument()
    const heads = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(heads).toEqual(['Мышцы и оборудование', 'Как выполнять', 'На что обратить внимание', 'Частые ошибки'])
    expect(screen.getByRole('dialog', { name: 'Жим лежа со штангой' })).toBeInTheDocument()
    expect(screen.getByText('середина груди', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Источники рисунков')).toBeInTheDocument()
    expect(screen.getByText(/Everkinetic \(Greg Priday\), лицензия CC BY-SA 4\.0/)).toBeInTheDocument()
  })

  it('кадры сменяются сами без мигания подписей; пауза и выбор позы останавливают смену', async () => {
    mockReducedMotion(false)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    render(<TechniqueSheet slug="bench-press" name="Жим лежа со штангой" onClose={vi.fn()} />)
    // Лист рендерится порталом в body — ищем по документу.
    const shown = () => document.querySelector('.technique-stage img.is-on').getAttribute('alt')
    await screen.findByRole('button', { name: 'Руки выпрямлены' })
    expect(shown()).toBe('Жим лежа со штангой: Руки выпрямлены')
    // Во время смены подписи не подсвечиваются
    expect(screen.getByRole('button', { name: 'Руки выпрямлены' })).toHaveAttribute('aria-pressed', 'false')
    await act(async () => { vi.advanceTimersByTime(1200) })
    expect(shown()).toBe('Жим лежа со штангой: Гриф у груди')
    expect(screen.getByRole('button', { name: 'Гриф у груди' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Остановить смену кадров' }))
    expect(screen.getByRole('button', { name: 'Гриф у груди' })).toHaveAttribute('aria-pressed', 'true')
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(shown()).toBe('Жим лежа со штангой: Гриф у груди')

    fireEvent.click(screen.getByRole('button', { name: 'Запустить смену кадров' }))
    fireEvent.click(screen.getByRole('button', { name: 'Руки выпрямлены' }))
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(shown()).toBe('Жим лежа со штангой: Руки выпрямлены')
    expect(screen.getByRole('button', { name: 'Руки выпрямлены' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Запустить смену кадров' })).toBeInTheDocument()
  })

  it('при «уменьшить движение» — оба кадра рядом, без кнопок смены', async () => {
    mockReducedMotion(true)
    render(<TechniqueSheet slug="bench-press" name="Жим лежа со штангой" onClose={vi.fn()} />)
    expect(await screen.findByAltText('Жим лежа со штангой: Руки выпрямлены')).toBeInTheDocument()
    expect(screen.getByAltText('Жим лежа со штангой: Гриф у груди')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /смену кадров/ })).toBeNull()
  })

  it('кадр не загрузился — блок кадров пропадает, текст остается', async () => {
    mockReducedMotion(false)
    render(<TechniqueSheet slug="bench-press" name="Жим лежа со штангой" onClose={vi.fn()} />)
    const img = await screen.findByAltText('Жим лежа со штангой: Руки выпрямлены')
    fireEvent.error(img)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('button', { name: /смену кадров/ })).toBeNull()
    expect(screen.getByText('Частые ошибки')).toBeInTheDocument()
  })

  it('без кадров — только текст и без строки об источниках рисунков', async () => {
    render(<TechniqueSheet slug="lat-pulldown" name="Тяга верхнего блока" onClose={vi.fn()} />)
    expect(await screen.findByText('Частые ошибки')).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByText('Источники рисунков')).toBeNull()
  })

  it('закрытие: «закрыть» зовет onClose, после размонтирования таймер смены снят', async () => {
    mockReducedMotion(false)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const onClose = vi.fn()
    const { unmount } = render(<TechniqueSheet slug="bench-press" name="Жим лежа со штангой" onClose={onClose} />)
    await screen.findByRole('button', { name: 'Руки выпрямлены' })
    fireEvent.click(screen.getByRole('button', { name: 'закрыть' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
