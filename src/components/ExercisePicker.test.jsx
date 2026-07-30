// @vitest-environment jsdom
//
// Пикер — единственная точка, где умный поиск встречается с фильтром по группе
// и с предложением «+ Создать». Чистая шкала ранжирования покрыта в
// lib/exerciseSearch.test.js; здесь — только эта склейка.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ExercisePicker from './ExercisePicker.jsx'

const CATALOG = [
  { id: 'bench', name: 'Жим лёжа', muscle_group: 'грудь', submuscle: 'chest_middle', secondary: ['triceps'] },
  { id: 'pulldown', name: 'Тяга верхнего блока', muscle_group: 'спина', submuscle: 'lats', secondary: [] },
  { id: 'press-seated', name: 'Жим гантелей сидя', muscle_group: 'плечи', submuscle: 'delt_front', secondary: [] },
]

function renderPicker(over = {}) {
  const onPick = vi.fn()
  const onCreate = vi.fn()
  render(
    <ExercisePicker
      exercises={CATALOG}
      onPick={onPick}
      onClose={vi.fn()}
      onCreate={onCreate}
      {...over}
    />
  )
  return { onPick, onCreate, search: screen.getByPlaceholderText('Поиск по названию…') }
}

const type = (input, value) => fireEvent.change(input, { target: { value } })

describe('ExercisePicker — умный поиск', () => {
  it('находит упражнение по мышце и объясняет это заголовком', async () => {
    const { search } = renderPicker()
    type(search, 'плеч')

    expect(await screen.findByText('По мышцам')).toBeInTheDocument()
    expect(screen.getByText('Жим гантелей сидя')).toBeInTheDocument()
    expect(screen.queryByText('Жим лёжа')).not.toBeInTheDocument()
    // Просмотр группы — не заявка на упражнение с названием «плеч».
    expect(screen.queryByText(/Создать/)).not.toBeInTheDocument()
    expect(screen.getByText('+ добавить своё упражнение')).toBeInTheDocument()
  })

  it('находит существующее упражнение без ё и не предлагает создать дубль', async () => {
    const { search } = renderPicker()
    type(search, 'жим лежа')

    expect(await screen.findByText('Жим лёжа')).toBeInTheDocument()
    expect(screen.queryByText(/Создать/)).not.toBeInTheDocument()
  })

  it('предлагает создать только реально новое название', async () => {
    const { search } = renderPicker()
    type(search, 'Жим Арнольда')

    expect(await screen.findByText('+ Создать «Жим Арнольда»')).toBeInTheDocument()
  })

  it('фильтр по группе сужает результат поиска', async () => {
    const { search } = renderPicker()
    type(search, 'жим')
    expect(await screen.findByText('Жим гантелей сидя')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'грудь' }))

    expect(await screen.findByText('Жим лёжа')).toBeInTheDocument()
    expect(screen.queryByText('Жим гантелей сидя')).not.toBeInTheDocument()
  })

  it('выбор из блока «По мышцам» отдаёт упражнение родителю', async () => {
    const { search, onPick } = renderPicker()
    type(search, 'плеч')

    fireEvent.click(await screen.findByText('Жим гантелей сидя'))
    expect(onPick).toHaveBeenCalledWith(CATALOG[2])
  })
})
