// @vitest-environment jsdom
//
// Пикер — единственная точка, где умный поиск встречается с фильтром по группе
// и с предложением «+ Создать». Чистая шкала ранжирования покрыта в
// lib/exerciseSearch.test.js; здесь — только эта склейка.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ExercisePicker from './ExercisePicker.jsx'

const CATALOG = [
  { id: 'bench', name: 'Жим лежа', muscle_group: 'грудь', submuscle: 'chest_middle', secondary: ['triceps'] },
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
    expect(screen.queryByText('Жим лежа')).not.toBeInTheDocument()
    // Просмотр группы — не заявка на упражнение с названием «плеч».
    expect(screen.queryByText(/Создать/)).not.toBeInTheDocument()
    expect(screen.getByText('+ добавить свое упражнение')).toBeInTheDocument()
  })

  it('находит существующее упражнение без е и не предлагает создать дубль', async () => {
    const { search } = renderPicker()
    type(search, 'жим лежа')

    expect(await screen.findByText('Жим лежа')).toBeInTheDocument()
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

    expect(await screen.findByText('Жим лежа')).toBeInTheDocument()
    expect(screen.queryByText('Жим гантелей сидя')).not.toBeInTheDocument()
  })

  it('выбор из блока «По мышцам» отдает упражнение родителю', async () => {
    const { search, onPick } = renderPicker()
    type(search, 'плеч')

    fireEvent.click(await screen.findByText('Жим гантелей сидя'))
    expect(onPick).toHaveBeenCalledWith(CATALOG[2])
  })
})

describe('ExercisePicker — ⭐ избранные (v6.5.0)', () => {
  it('без onToggleFavorite звезд нет', () => {
    renderPicker()
    expect(screen.queryByRole('button', { name: 'В избранное' })).not.toBeInTheDocument()
  })

  it('избранное — первым блоком и не дублируется в «Недавних»', () => {
    renderPicker({
      favorites: ['pulldown'],
      onToggleFavorite: vi.fn(),
      usage: { recent: ['pulldown', 'bench'], frequent: [] },
    })
    const titles = screen.getAllByText(/^(Избранные|Недавние|Все упражнения)$/).map((n) => n.textContent)
    expect(titles).toEqual(['Избранные', 'Недавние', 'Все упражнения'])
    // Тяга — только в избранном, жим — только в недавних, в «Все» — остаток.
    expect(screen.getAllByText('Тяга верхнего блока')).toHaveLength(1)
    expect(screen.getAllByText('Жим лежа')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Убрать из избранного' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('тап по звезде переключает избранное и НЕ добавляет упражнение', () => {
    const onToggleFavorite = vi.fn()
    const { onPick } = renderPicker({ onToggleFavorite })
    fireEvent.click(screen.getAllByRole('button', { name: 'В избранное' })[0])
    expect(onToggleFavorite).toHaveBeenCalledWith('bench')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('при поиске блок избранного прячется, звезды в результатах остаются', async () => {
    const { search } = renderPicker({ favorites: ['bench'], onToggleFavorite: vi.fn() })
    type(search, 'жим')
    expect(await screen.findByText('Жим гантелей сидя')).toBeInTheDocument()
    expect(screen.queryByText('Избранные')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Убрать из избранного' })).toBeInTheDocument()
  })
})
