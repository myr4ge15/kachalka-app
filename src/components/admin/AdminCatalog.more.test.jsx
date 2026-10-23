// @vitest-environment jsdom
// Админка: справочник упражнений и дисциплины рейтинга (покрытие тестами 20.10.2026:
// ExercisesSection 78 %, AdminDisciplines 77 % строк). Поиск, правка (тип уходит только при
// смене, разметка мышц), быстрое скрыть/показать без потери разметки, ошибки и офлайн;
// дисциплины: «Раздельно по полу», «Обновить список», ошибки загрузки и сохранения.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ExercisesSection from './ExercisesSection.jsx'
import AdminDisciplines from './AdminDisciplines.jsx'
import { adminUpdateExercise, adminMergeExercise } from '../../lib/admin.js'
import { showToast } from '../ui/Toast.jsx'

vi.mock('../../lib/admin.js', () => ({ adminUpdateExercise: vi.fn(async () => {}), adminMergeExercise: vi.fn(async () => true) }))
vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))
const disc = vi.hoisted(() => ({ catalog: null, fetch: null, save: null }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (fn) => fn() }))
vi.mock('../../db/disciplines.js', () => ({ getRatingCatalog: () => disc.catalog, fetchRatingCatalog: (...a) => disc.fetch(...a) }))
vi.mock('../../lib/adminDisciplines.js', () => ({ adminSaveDiscipline: (...a) => disc.save(...a) }))

const EX = [
  { id: 'bp', name: 'Жим лежа', muscle_group: 'грудь', submuscle: 'chest_middle', secondary: ['triceps'], metric: 'weight' },
  { id: 'pl', name: 'Планка', muscle_group: 'пресс', metric: 'time', is_hidden: true },
  { id: 'pl2', name: 'планка', muscle_group: 'пресс', metric: 'time' },
]
const errMsg = (e) => e.message

beforeEach(() => {
  disc.catalog = { items: [{ id: 'd1', exercise_id: 'bp', name: 'Жим лежа', metric: 'weight', split_by_sex: false }] }
  disc.fetch = vi.fn(async () => {})
  disc.save = vi.fn(async () => ({ refreshed: true }))
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => vi.clearAllMocks())

describe('ExercisesSection', () => {
  // С 23.10.2026 — общий каталог (components/exercises/ExerciseCatalog.jsx) в режиме Админки.
  const row = (name) => screen.getByText(name, { selector: '.picker-item > span:first-child' }).closest('.picker-item')

  it('разделы и поиск без учета «ё»; скрытые видны с пометкой; пусто — «Ничего не найдено»', () => {
    render(<ExercisesSection exercises={EX} userId="adm" online errMsg={errMsg} />)
    expect(screen.getByText('Базовые')).toBeInTheDocument()
    expect(row('Планка')).toHaveTextContent('скрыто')
    const search = screen.getByLabelText('Поиск упражнения')
    fireEvent.change(search, { target: { value: 'ЖИМ' } })
    expect(screen.getByText('Жим лежа', { selector: '.picker-item > span:first-child' })).toBeInTheDocument()
    expect(screen.queryByText('Планка', { selector: '.picker-item > span:first-child' })).toBeNull()
    fireEvent.change(search, { target: { value: 'ёжик' } })
    expect(screen.getByText('Ничего не найдено.')).toBeInTheDocument()
  })

  it('правка любого: группа из списка сбрасывает подмышцу, тип уходит только при смене, флаги рейтинга целы', async () => {
    const ex = [{ ...EX[0], is_bench_lift: true }, ...EX.slice(1)]
    render(<ExercisesSection exercises={ex} userId="adm" online errMsg={errMsg} />)
    fireEvent.click(row('Жим лежа'))
    fireEvent.change(screen.getByLabelText('Название упражнения'), { target: { value: 'Жим лежа штангой' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(adminUpdateExercise).toHaveBeenCalled())
    expect(adminUpdateExercise.mock.calls[0][0]).toMatchObject({
      id: 'bp', name: 'Жим лежа штангой', submuscle: 'chest_middle', metric: undefined, is_bench_lift: true, is_hidden: false,
    })
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Упражнение обновлено' }))

    fireEvent.click(row('Жим лежа'))
    fireEvent.click(screen.getByRole('button', { name: 'плечи' }))
    fireEvent.click(screen.getByRole('button', { name: 'Только повторения' }))
    expect(screen.getByText(/Уже записанные подходы не пересчитываются/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Скрыть из пикера' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(adminUpdateExercise).toHaveBeenCalledTimes(2))
    expect(adminUpdateExercise.mock.calls[1][0]).toMatchObject({ muscle_group: 'плечи', secondary: [], metric: 'reps', is_hidden: true })
  })

  it('ошибка сохранения — тост с причиной, форма остается; «Отмена» возвращает список', async () => {
    adminUpdateExercise.mockRejectedValueOnce(new Error('admin only'))
    render(<ExercisesSection exercises={EX} userId="adm" online errMsg={errMsg} />)
    fireEvent.click(row('Жим лежа'))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не удалось', sub: 'admin only' })))
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
    expect(screen.getByLabelText('Поиск упражнения')).toBeInTheDocument()
  })

  it('быстро скрыть/показать — разметка мышц сохраняется; ошибка — тост', async () => {
    render(<ExercisesSection exercises={EX} userId="adm" online errMsg={errMsg} />)
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть «Жим лежа» из пикера' }))
    await waitFor(() => expect(adminUpdateExercise).toHaveBeenCalledWith(expect.objectContaining({ id: 'bp', submuscle: 'chest_middle', secondary: ['triceps'], is_hidden: true })))
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Скрыто из пикера' }))
    fireEvent.click(screen.getByRole('button', { name: 'Показать «Планка» в пикере' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Показано в пикере' })))
    adminUpdateExercise.mockRejectedValueOnce(new Error('x'))
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть «Жим лежа» из пикера' }))
    await waitFor(() => expect(showToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Не удалось' })))
  })

  it('офлайн: «Сохранить», скрытие и «Слить» неактивны — запросов нет', () => {
    render(<ExercisesSection exercises={EX} userId="adm" online={false} errMsg={errMsg} />)
    for (const b of screen.getAllByRole('button', { name: /^(Скрыть|Показать) «/ })) expect(b).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Слить дубль/ }))
    const [from, into] = screen.getAllByRole('combobox').slice(-2)
    fireEvent.change(from, { target: { value: 'pl2' } })
    fireEvent.change(into, { target: { value: 'bp' } })
    expect(screen.getByRole('button', { name: 'Слить' })).toBeDisabled()
    fireEvent.click(row('Жим лежа'))
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    expect(adminUpdateExercise).not.toHaveBeenCalled()
    expect(adminMergeExercise).not.toHaveBeenCalled()
  })

  it('слияние: вероятный дубль подсвечен; ошибка — тост; «Отмена» закрывает', async () => {
    adminMergeExercise.mockRejectedValueOnce(new Error('already merged'))
    render(<ExercisesSection exercises={EX} online errMsg={errMsg} />)
    fireEvent.click(screen.getByRole('button', { name: /Слить дубль/ }))
    const [from, into] = screen.getAllByRole('combobox')
    fireEvent.change(from, { target: { value: 'pl2' } })
    expect(within(into).getAllByRole('option').some((o) => /похоже на дубль/.test(o.textContent))).toBe(false) // скрытая планка — не цель
    fireEvent.change(into, { target: { value: 'bp' } })
    fireEvent.click(screen.getByRole('button', { name: 'Слить' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не удалось слить', sub: 'already merged' })))
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('button', { name: 'Слить' })).toBeNull()
  })
})

describe('AdminDisciplines', () => {
  it('«Раздельно по полу» у дисциплины → сохранение с флагом', async () => {
    render(<AdminDisciplines userId="admin" exercises={EX} online />)
    fireEvent.click(within(screen.getByRole('list')).getByRole('checkbox', { name: 'Раздельно по полу' }))
    await waitFor(() => expect(disc.save).toHaveBeenCalledWith('admin', expect.objectContaining({ exercise_id: 'bp', split_by_sex: true })))
  })

  it('добавить без разделения; сохранилось, но список не обновился — подсказка', async () => {
    disc.save.mockResolvedValue({ refreshed: false })
    render(<AdminDisciplines userId="admin" exercises={EX} online />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Упражнение' }), { target: { value: 'pl2' } })
    const addForm = screen.getByRole('button', { name: 'Добавить дисциплину' }).closest('form')
    fireEvent.click(within(addForm).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Добавить дисциплину' }))
    await waitFor(() => expect(disc.save).toHaveBeenCalledWith('admin', { exercise_id: 'pl2', split_by_sex: false }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Нажми «Обновить список»')
  })

  it('ошибки: загрузка, сохранение, ручное обновление', async () => {
    disc.fetch = vi.fn(async () => { throw new Error('PGRST202') })
    disc.save.mockRejectedValue(new Error('Нет прав'))
    render(<AdminDisciplines userId="admin" exercises={EX} online />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить дисциплины')
    fireEvent.click(screen.getByRole('button', { name: 'Убрать из рейтинга: Жим лежа' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Нет прав'))
    fireEvent.click(screen.getByRole('button', { name: 'Обновить список' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не удалось обновить список.'))
  })

  it('каталог пуст — «Дисциплин пока нет»', () => {
    disc.catalog = { items: [] }
    render(<AdminDisciplines userId="admin" exercises={EX} online={false} />)
    expect(screen.getByText('Дисциплин пока нет.')).toBeInTheDocument()
    expect(disc.fetch).not.toHaveBeenCalled()
  })
})
