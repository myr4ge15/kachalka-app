// @vitest-environment jsdom
// Справочник в Админке (v8.2.0): слитые дубли — не упражнения. В списке их нет
// (кнопкой 👁 из алиаса получился бы живой дубль), под списком — сводка; слить
// можно только не слитое и только в видимое, общее — только в общее.
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExercisesSection from './ExercisesSection.jsx'
import { adminMergeExercise } from '../../lib/admin.js'

vi.mock('../../lib/admin.js', () => ({ adminUpdateExercise: vi.fn(), adminMergeExercise: vi.fn(async () => true) }))
vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))

const EX = [
  { id: 'lat', name: 'Тяга верхнего блока', muscle_group: 'спина', is_custom: false },
  { id: 'bp', name: 'Жим лежа со штангой', muscle_group: 'грудь', is_custom: false },
  { id: 'mine', name: 'Тяга каната', muscle_group: 'спина', is_custom: true },
  { id: 'off', name: 'Убрано из пикера', muscle_group: 'спина', is_custom: false, is_hidden: true },
  { id: 'a1', name: 'Тяга верхнего блока', muscle_group: 'спина', is_hidden: true, merged_into: 'lat' },
  { id: 'a2', name: 'Тяга верхнего блока', muscle_group: 'спина', is_hidden: true, merged_into: 'lat' },
]
const optionValues = (select) => within(select).getAllByRole('option').map((o) => o.value).filter(Boolean)

describe('ExercisesSection — слитые дубли', () => {
  it('алиасов нет в списке, есть сводка «Слито дублей»', () => {
    render(<ExercisesSection exercises={EX} userId="adm" online errMsg={String} />)
    expect(screen.getAllByText('Тяга верхнего блока', { selector: '.picker-item > span:first-child' })).toHaveLength(1)
    expect(screen.getByText('Убрано из пикера')).toBeInTheDocument() // просто скрытое — остается
    expect(screen.getByText('Слито дублей: 2')).toBeInTheDocument()
    expect(screen.getByText('Тяга верхнего блока ← 2')).toBeInTheDocument()
  })

  it('слить: источники без алиасов, цели — видимые; общее только в общее', async () => {
    const user = userEvent.setup()
    render(<ExercisesSection exercises={EX} userId="adm" online errMsg={String} />)
    await user.click(screen.getByRole('button', { name: /Слить дубль/ }))
    const [from, into] = screen.getAllByRole('combobox')
    expect(optionValues(from)).toEqual(['lat', 'bp', 'mine', 'off'])
    await user.selectOptions(from, 'bp')
    expect(optionValues(into)).toEqual(['lat']) // общее — не в «свое» и не в скрытое
    await user.selectOptions(from, 'mine')
    expect(optionValues(into)).toEqual(['lat', 'bp'])
    await user.selectOptions(into, 'lat')
    await user.click(screen.getByRole('button', { name: 'Слить' }))
    expect(adminMergeExercise).toHaveBeenCalledWith('mine', 'lat')
  })

  it('без слитых сводки нет', () => {
    render(<ExercisesSection exercises={EX.slice(0, 4)} online errMsg={String} />)
    expect(screen.queryByText(/Слито дублей/)).toBeNull()
  })
})
