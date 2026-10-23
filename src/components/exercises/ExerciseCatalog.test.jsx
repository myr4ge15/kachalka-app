// @vitest-environment jsdom
// Общий каталог упражнений (23.10.2026): участник и Админка видят один список — разделы, поиск,
// у участника правится только свое, в Админке — все, скрытые с пометкой и кнопкой «Показать».
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ExerciseCatalog from './ExerciseCatalog.jsx'
import ExerciseEditForm from './ExerciseEditForm.jsx'

const LIST = [
  { id: 'm', name: 'Мой ёжик-жим', is_custom: true, owner_id: 'me', muscle_group: 'грудь', metric: 'weight' },
  { id: 'o', name: 'Чужая тяга', is_custom: true, owner_id: 'x', muscle_group: 'спина', metric: 'reps' },
  { id: 'b', name: 'Планка', is_custom: false, muscle_group: 'пресс', metric: 'time', is_hidden: true },
]
const title = (t) => screen.queryByText(t, { selector: '.catalog-title' })

describe('ExerciseCatalog', () => {
  it('участник: правит свое, чужое и базовое — статично, кнопок скрытия нет', () => {
    const onEdit = vi.fn()
    render(<ExerciseCatalog list={LIST} userId="me" onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: /Мой ёжик-жим/ }))
    expect(onEdit).toHaveBeenCalledWith(LIST[0])
    expect(screen.queryByRole('button', { name: /Чужая тяга/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Скрыть|Показать/ })).toBeNull()
    expect(screen.getByText('Планка').closest('.picker-item')).not.toHaveTextContent('скрыто')
  })

  it('поиск без учета «ё» прячет пустые разделы; ничего — «Ничего не найдено»', () => {
    render(<ExerciseCatalog list={LIST} userId="me" onEdit={vi.fn()} />)
    const search = screen.getByLabelText('Поиск упражнения')
    fireEvent.change(search, { target: { value: 'ежик' } })
    expect(title('Добавлено мной')).toBeTruthy()
    expect(title('Базовые')).toBeNull()
    fireEvent.change(search, { target: { value: 'кардио-марафон' } })
    expect(screen.getByText('Ничего не найдено.')).toBeInTheDocument()
  })

  it('Админка: правится все; скрытое с пометкой и «Показать»', () => {
    const onEdit = vi.fn()
    const onToggleHidden = vi.fn()
    render(<ExerciseCatalog list={LIST} userId="adm" admin onEdit={onEdit} onToggleHidden={onToggleHidden} />)
    fireEvent.click(screen.getByRole('button', { name: /^Чужая тяга/ }))
    expect(onEdit).toHaveBeenCalledWith(LIST[1])
    expect(screen.getByRole('button', { name: /^Планка/ })).toHaveTextContent('на время · пресс · скрыто')
    fireEvent.click(screen.getByRole('button', { name: 'Показать «Планка» в пикере' }))
    expect(onToggleHidden).toHaveBeenCalledWith(LIST[2])
  })
})

describe('ExerciseEditForm', () => {
  const groups = ['грудь', 'спина']
  it('смена типа предупреждает участника; без группы — ошибка, onSubmit не зовется', () => {
    const onSubmit = vi.fn()
    render(<ExerciseEditForm ex={{ id: 'x', name: 'Новое', metric: 'weight' }} groups={groups} onCancel={vi.fn()} onSubmit={onSubmit} />)
    expect(screen.queryByRole('checkbox', { name: 'Скрыть из пикера' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'На время' }))
    expect(screen.getByText(/Уже записанные подходы не пересчитываются/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.getByText('Выбери группу мышц.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'грудь' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Новое', muscle_group: 'грудь', metric: 'time', is_hidden: false }))
  })

  it('незнакомая группа упражнения остается выбранной в списке; ошибка экрана видна; занятость — кнопки неактивны', () => {
    const { rerender } = render(<ExerciseEditForm ex={{ id: 'x', name: 'А', muscle_group: 'шея' }} groups={groups}
      error="Не удалось сохранить: x" onCancel={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'шея' })).toHaveClass('active')
    expect(screen.getByText('Не удалось сохранить: x')).toBeInTheDocument()
    rerender(<ExerciseEditForm ex={{ id: 'x', name: 'А', muscle_group: 'шея' }} groups={groups} busy onCancel={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Сохранение…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled()
  })
})
