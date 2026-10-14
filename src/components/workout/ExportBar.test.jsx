// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ExportBar from './ExportBar.jsx'

const handlers = () => ({ onToggleMode: vi.fn(), onPickAll: vi.fn(), onExport: vi.fn() })

describe('ExportBar', () => {
  it('вне режима выбора — одна ссылка входа в режим', () => {
    const h = handlers()
    render(<ExportBar selectMode={false} label="Экспорт тренировок" {...h} />)
    fireEvent.click(screen.getByRole('button', { name: /Экспорт тренировок/ }))
    expect(h.onToggleMode).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Выбрано/)).toBeNull()
  })

  it('canShow=false (пустой список) — ничего не рисует', () => {
    const { container } = render(<ExportBar selectMode={false} canShow={false} label="Экспорт" {...handlers()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('в режиме выбора без отметок — «Скачать» неактивна, Все/Отмена работают', () => {
    const h = handlers()
    render(<ExportBar selectMode count={0} label="x" {...h} />)
    expect(screen.getByText('Выбрано: 0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '⬇ Скачать' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Все' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(h.onPickAll).toHaveBeenCalledTimes(1)
    expect(h.onToggleMode).toHaveBeenCalledTimes(1)
  })

  it('с отметками — счетчик на кнопке, нажатие экспортирует', () => {
    const h = handlers()
    render(<ExportBar selectMode count={3} label="x" {...h} />)
    fireEvent.click(screen.getByRole('button', { name: '⬇ Скачать (3)' }))
    expect(h.onExport).toHaveBeenCalledTimes(1)
  })
})
