// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import MyExercisesScreen from './MyExercisesScreen.jsx'
import { updateExercise } from '../db/repo.js'

// Разбиение каталога и право правки — lib/exerciseCatalog.js (свои тесты).
const mocks = vi.hoisted(() => ({ list: undefined }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => mocks.list }))
vi.mock('../db/repo.js', () => ({ getExercises: vi.fn(), updateExercise: vi.fn() }))

const MINE = { id: 'm1', name: 'Мой жим', is_custom: true, owner_id: 'me', muscle_group: 'грудь',
  submuscle: 'chest_upper', secondary: ['triceps'], metric: 'weight' }
const OTHER = { id: 'o1', name: 'Петин присед', is_custom: true, owner_id: 'petya', muscle_group: 'ноги', metric: 'reps' }
const BASE = { id: 'b1', name: 'Жим лежа', is_custom: false, muscle_group: 'грудь', metric: 'time' }

const renderScreen = () => render(<MyExercisesScreen user={{ id: 'me' }} onBack={vi.fn()} />)
const sectionCount = (title) => screen.getByText(title).querySelector('.catalog-count').textContent

describe('MyExercisesScreen', () => {
  beforeEach(() => {
    mocks.list = undefined
    vi.mocked(updateExercise).mockReset().mockResolvedValue()
  })

  it('загрузка — каркас; пустой справочник — подсказка, где создать', () => {
    const { unmount } = renderScreen()
    expect(screen.getByLabelText('Загрузка')).toBeInTheDocument()
    unmount()
    mocks.list = []
    renderScreen()
    expect(screen.getByText(/Справочник пуст/)).toBeInTheDocument()
  })

  it('три раздела со счетчиками; править можно только свое, чужое и базовое — статично', () => {
    mocks.list = [BASE, OTHER, MINE]
    renderScreen()
    expect(sectionCount('Добавлено мной')).toBe('1')
    expect(sectionCount('Добавлено другими')).toBe('1')
    expect(sectionCount('Базовые')).toBe('1')
    expect(screen.getByRole('button', { name: /Мой жим/ })).toHaveTextContent('вес и повторения')
    expect(screen.queryByRole('button', { name: /Петин присед/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Жим лежа/ })).toBeNull()
    expect(screen.getByText('Петин присед').closest('.picker-item')).toHaveTextContent('только повторения')
    expect(screen.getByText('Жим лежа').closest('.picker-item')).toHaveTextContent('на время')
  })

  it('пустой раздел не прячется — объясняет', () => {
    mocks.list = [BASE]
    renderScreen()
    expect(screen.getByText('Ты пока не добавлял своих упражнений.')).toBeInTheDocument()
    expect(screen.getByText('Пока никто, кроме тебя.')).toBeInTheDocument()
  })

  it('правка: форма с текущими значениями, сохранение отдает поля и автора правки', async () => {
    mocks.list = [MINE, BASE]
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: /Мой жим/ }))
    const name = screen.getByPlaceholderText('Название упражнения')
    expect(name).toHaveValue('Мой жим')
    expect(screen.getByRole('button', { name: 'верх груди' })).toHaveClass('active')
    fireEvent.change(name, { target: { value: '  Жим под углом ' } })
    fireEvent.click(screen.getByRole('button', { name: 'На время' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(updateExercise).toHaveBeenCalledWith({
      id: 'm1', name: 'Жим под углом', muscle_group: 'грудь', metric: 'time',
      submuscle: 'chest_upper', secondary: ['triceps'], editor_id: 'me',
    }))
    expect(await screen.findByText('Каталог упражнений')).toBeInTheDocument() // вернулись к списку
  })

  it('смена группы сбрасывает подмышцу на дефолт группы и чистит вторичные', async () => {
    mocks.list = [MINE]
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: /Мой жим/ }))
    fireEvent.click(screen.getByRole('button', { name: 'спина' }))
    expect(screen.getByRole('button', { name: 'широчайшие' })).toHaveClass('active')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(updateExercise).toHaveBeenCalledWith(expect.objectContaining({
      muscle_group: 'спина', submuscle: 'lats', secondary: [],
    })))
  })

  it('выбор основной мышцы убирает ее из вторичных; вторичные переключаются', async () => {
    mocks.list = [{ ...MINE, secondary: ['chest_middle'] }]
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: /Мой жим/ }))
    const primary = screen.getByText('Основная мышца').nextElementSibling
    fireEvent.click(within(primary).getByRole('button', { name: 'середина груди' }))
    const sec = screen.getByText(/Вторичные мышцы/).nextElementSibling
    fireEvent.click(within(sec).getByRole('button', { name: /^трицепс/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(updateExercise).toHaveBeenCalledWith(expect.objectContaining({
      submuscle: 'chest_middle', secondary: ['triceps'],
    })))
  })

  it('пустое название — ошибка без сохранения; сбой сохранения — текст и форма остается', async () => {
    mocks.list = [MINE]
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: /Мой жим/ }))
    fireEvent.change(screen.getByPlaceholderText('Название упражнения'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.getByText('Введи название упражнения.')).toBeInTheDocument()
    expect(updateExercise).not.toHaveBeenCalled()
    fireEvent.change(screen.getByPlaceholderText('Название упражнения'), { target: { value: 'Жим' } })
    vi.mocked(updateExercise).mockRejectedValue(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Не удалось сохранить: offline')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
  })

  it('«назад» из формы возвращает к списку без сохранения', () => {
    mocks.list = [MINE]
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: /Мой жим/ }))
    fireEvent.click(screen.getByRole('button', { name: /назад/i }))
    expect(screen.getByText('Каталог упражнений')).toBeInTheDocument()
    expect(updateExercise).not.toHaveBeenCalled()
  })
})
