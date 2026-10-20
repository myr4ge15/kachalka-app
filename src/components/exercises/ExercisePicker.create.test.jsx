// @vitest-environment jsdom
// Пикер: «Свое упражнение» (покрытие тестами 20.10.2026: ExercisePicker 66 % строк).
// Название из поиска, тип, группа → основная мышца по умолчанию, вторичные (основная из
// них выпадает), похожие — «выбери, уже есть»; проверки до сохранения, ошибка сохранения,
// «назад» к списку не стирает пикер. И кнопка сканера.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ExercisePicker from './ExercisePicker.jsx'

vi.mock('./ExerciseScanner.jsx', () => ({
  default: ({ onClose, onManual }) => (
    <div role="dialog" aria-label="Сканер">
      <button type="button" onClick={onClose}>Закрыть сканер</button>
      <button type="button" onClick={() => onManual('Тяга')}>Ввести вручную</button>
    </div>
  ),
}))

const CATALOG = [
  { id: 'bench', name: 'Жим лежа', muscle_group: 'грудь', submuscle: 'chest_middle', secondary: ['triceps'] },
  { id: 'pulldown', name: 'Тяга верхнего блока', muscle_group: 'спина', submuscle: 'lats', secondary: [] },
]

function renderPicker(over = {}) {
  const props = { exercises: CATALOG, onPick: vi.fn(), onClose: vi.fn(), onCreate: vi.fn(), ...over }
  render(<ExercisePicker {...props} />)
  return props
}
const search = () => screen.getByPlaceholderText('Поиск по названию…')
const openCreate = (text) => {
  fireEvent.change(search(), { target: { value: text } })
  fireEvent.click(screen.getByText(`+ Создать «${text}»`))
}
const chip = (name) => screen.getByRole('button', { name })

describe('ExercisePicker — свое упражнение', () => {
  it('название из поиска; тип, группа, основная по умолчанию, вторичные → onCreate и сразу в тренировку', async () => {
    const created = { id: 'new', name: 'Жим Арнольда' }
    const p = renderPicker({ onCreate: vi.fn(async () => created) })
    openCreate('Жим Арнольда')
    expect(screen.getByPlaceholderText('Название упражнения')).toHaveValue('Жим Арнольда')
    fireEvent.click(chip('Только повторения'))
    fireEvent.click(chip('На время'))
    fireEvent.click(chip('Дистанция и время'))
    fireEvent.click(chip('Вес и повторения'))
    fireEvent.click(chip('грудь'))
    expect(chip('середина груди')).toHaveClass('active') // основная по умолчанию
    fireEvent.click(chip('верх груди'))
    expect(chip('верх груди')).toHaveClass('active')
    const secondary = screen.getByText(/Вторичные мышцы/).nextElementSibling.querySelectorAll('button')
    fireEvent.click(secondary[0])
    expect(secondary[0]).toHaveClass('active')
    fireEvent.click(secondary[1])
    fireEvent.click(secondary[1]) // повторное нажатие снимает
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и добавить' }))
    await waitFor(() => expect(p.onPick).toHaveBeenCalledWith(created))
    const arg = p.onCreate.mock.calls[0][0]
    expect(arg).toMatchObject({ name: 'Жим Арнольда', muscle_group: 'грудь', metric: 'weight', submuscle: 'chest_upper' })
    expect(arg.secondary).toHaveLength(1)
  })

  it('без группы и без названия — подсказки, без сохранения', () => {
    const p = renderPicker()
    openCreate('Новое')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и добавить' }))
    expect(screen.getByText('Выбери группу мышц.')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Название упражнения'), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и добавить' }))
    expect(screen.getByText('Введи название упражнения.')).toBeInTheDocument()
    expect(p.onCreate).not.toHaveBeenCalled()
  })

  it('похожее уже есть — можно выбрать его вместо создания', () => {
    const p = renderPicker()
    openCreate('Жим лежа узко')
    fireEvent.click(screen.getByText(/Возможно, уже есть/).parentElement.querySelector('.similar-item'))
    expect(p.onPick).toHaveBeenCalledWith(CATALOG[0])
  })

  it('сохранить не вышло — текст ошибки, форма остается; «назад» — к списку', async () => {
    renderPicker({ onCreate: vi.fn(async () => { throw new Error('Нет сети') }) })
    openCreate('Пуловер')
    fireEvent.click(chip('грудь'))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и добавить' }))
    expect(await screen.findByText('Не удалось сохранить: Нет сети')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'назад' }))
    expect(search()).toBeInTheDocument()
  })

  it('выбранная группа фильтра переносится в форму', () => {
    renderPicker()
    fireEvent.click(chip('спина'))
    openCreate('Гиперэкстензия')
    expect(chip('спина')).toHaveClass('active')
  })
})

describe('ExercisePicker — сканер', () => {
  it('кнопка открывает сканер; «ввести вручную» — текст в поиск, группа сброшена', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Сканировать название' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ввести вручную' }))
    expect(search()).toHaveValue('Тяга')
    fireEvent.click(screen.getByRole('button', { name: 'Сканировать название' }))
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть сканер' }))
    expect(search()).toBeInTheDocument()
  })
})
