// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WorkoutActions from './WorkoutActions.jsx'

const base = (over = {}) => ({
  isNew: false, hasEntries: false, saving: false, tplBusy: false,
  clearArm: false, onArmClear: vi.fn(), onCancelClear: vi.fn(), onClearDraft: vi.fn(),
  onExport: vi.fn(),
  tplArm: false, onOpenTpl: vi.fn(), onCancelTpl: vi.fn(), tplName: '', onTplName: vi.fn(), onMakeTemplate: vi.fn(),
  delArm: false, onArmDel: vi.fn(), onCancelDel: vi.fn(), onDelete: vi.fn(),
  ...over,
})
const renderA = (over) => {
  const props = base(over)
  return { props, ...render(<WorkoutActions {...props} />) }
}

describe('WorkoutActions — существующая тренировка', () => {
  it('показывает экспорт / шаблон / удаление и дёргает колбэки', () => {
    const { props } = renderA({ isNew: false })
    fireEvent.click(screen.getByText('⬇ Экспорт в JSON'))
    expect(props.onExport).toHaveBeenCalled()
    fireEvent.click(screen.getByText('📋 Сделать шаблон из тренировки'))
    expect(props.onOpenTpl).toHaveBeenCalled()
    fireEvent.click(screen.getByText('Удалить тренировку'))
    expect(props.onArmDel).toHaveBeenCalled()
  })

  it('delArm → «Да, удалить» зовёт onDelete', () => {
    const { props } = renderA({ isNew: false, delArm: true })
    fireEvent.click(screen.getByText('Да, удалить'))
    expect(props.onDelete).toHaveBeenCalled()
  })

  it('tplArm: пустое имя блокирует «Создать шаблон», непустое — зовёт onMakeTemplate', () => {
    const props = base({ isNew: false, tplArm: true, tplName: '' })
    const { rerender } = render(<WorkoutActions {...props} />)
    expect(screen.getByText('Создать шаблон')).toBeDisabled()
    rerender(<WorkoutActions {...props} tplName="План А" />)
    const btn = screen.getByText('Создать шаблон')
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(props.onMakeTemplate).toHaveBeenCalled()
  })
})

describe('WorkoutActions — новая тренировка', () => {
  it('с составом показывает «Очистить черновик», прячет экспорт/удаление', () => {
    const { props } = renderA({ isNew: true, hasEntries: true })
    expect(screen.queryByText('⬇ Экспорт в JSON')).toBeNull()
    expect(screen.queryByText('Удалить тренировку')).toBeNull()
    fireEvent.click(screen.getByText('Очистить черновик'))
    expect(props.onArmClear).toHaveBeenCalled()
  })

  it('clearArm → подтверждение: «Да, очистить»/«Отмена»', () => {
    const { props } = renderA({ isNew: true, hasEntries: true, clearArm: true })
    fireEvent.click(screen.getByText('Да, очистить'))
    expect(props.onClearDraft).toHaveBeenCalled()
    fireEvent.click(screen.getByText('Отмена'))
    expect(props.onCancelClear).toHaveBeenCalled()
  })
})
