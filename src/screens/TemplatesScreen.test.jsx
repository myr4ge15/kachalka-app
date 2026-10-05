// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import TemplatesScreen from './TemplatesScreen.jsx'
import { deleteTemplate, getTemplate, saveTemplate } from '../db/repo.js'
import { syncNow } from '../db/sync.js'
import { exportTemplates } from '../lib/exportTemplate.js'

// Экран целиком: список (группы, экспорт) ↔ редактор (план, порядок, общий доступ,
// удаление). Нормализация и синк — repo.saveTemplate / sync (свои тесты).
const mocks = vi.hoisted(() => ({ templates: undefined, exercises: [] }))
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (fn, _deps, def) => { const v = fn(); return v === undefined ? def : v },
}))
vi.mock('../db/repo.js', () => ({
  getTemplates: () => mocks.templates,
  getExercises: () => mocks.exercises,
  getFavorites: () => [],
  getTemplate: vi.fn(),
  saveTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  createExercise: vi.fn(),
  toggleFavorite: vi.fn(),
}))
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn() }))
vi.mock('../lib/exportTemplate.js', () => ({ exportTemplates: vi.fn() }))
vi.mock('../components/ExercisePicker.jsx', () => ({
  default: ({ exercises, onPick, onClose }) => (
    <div data-testid="picker">
      {exercises.map((e) => <button key={e.id} onClick={() => onPick(e)}>выбрать {e.name}</button>)}
      <button onClick={onClose}>закрыть пикер</button>
    </div>
  ),
}))

const ME = { id: 'me' }
const BENCH = { id: 'bench', name: 'Жим лежа', metric: 'weight' }
const PULL = { id: 'pull', name: 'Подтягивания', metric: 'reps' }
const PLANK = { id: 'plank', name: 'Планка', metric: 'time' }
const MY_TPL = { id: 't1', user_id: 'me', name: 'Грудь', is_public: true, _dirty: true,
  exercises: [{ exercise: BENCH, sets: 4, reps: 8, weight: 60 }] }
const THEIR_TPL = { id: 't2', user_id: 'petya', name: 'Спина', author_name: 'Петя',
  exercises: [{ exercise: PULL, sets: 3, reps: 10, weight: 0 }] }

let onBack
const renderScreen = () => { onBack = vi.fn(); return render(<TemplatesScreen user={ME} onBack={onBack} />) }
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

describe('TemplatesScreen — список', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.templates = undefined
    vi.mocked(exportTemplates).mockReset()
  })

  it('загрузка — каркас; пусто — приглашение создать, без экспорта', () => {
    const { unmount } = renderScreen()
    expect(screen.getByLabelText('Загрузка')).toBeInTheDocument()
    unmount()
    mocks.templates = []
    renderScreen()
    expect(screen.getByText('Пока нет шаблонов. Создай первый.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Экспорт шаблонов/ })).toBeNull()
  })

  it('группы свернуты по умолчанию, раскрытие запоминается на пользователя', () => {
    mocks.templates = [MY_TPL, THEIR_TPL]
    const { unmount } = renderScreen()
    const mine = screen.getByRole('button', { name: /Мои шаблоны/ })
    expect(mine).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Грудь')).toBeNull()
    fireEvent.click(mine)
    expect(localStorage.getItem('tpl_group_mine_me')).toBe('1')
    unmount()
    renderScreen()
    expect(screen.getByRole('button', { name: /Мои шаблоны/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Общие/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('карточки: свой общий — 🌐 и «ждет синка», чужой — автор; план упражнения', () => {
    localStorage.setItem('tpl_group_mine_me', '1')
    localStorage.setItem('tpl_group_shared_me', '1')
    mocks.templates = [MY_TPL, THEIR_TPL]
    renderScreen()
    const mine = screen.getByText('Грудь').closest('button')
    expect(mine).toHaveTextContent('🌐 общий')
    expect(within(mine).getByTitle('Ждет синхронизации')).toBeInTheDocument()
    expect(mine).toHaveTextContent('4×8×60 кг')
    const theirs = screen.getByText('Спина').closest('button')
    expect(theirs).toHaveTextContent('· от Петя')
    expect(theirs).not.toHaveTextContent('🌐')
  })

  it('экспорт: выбор карточек вместо открытия, «Скачать» отдает выбранные', () => {
    localStorage.setItem('tpl_group_mine_me', '1')
    localStorage.setItem('tpl_group_shared_me', '1')
    mocks.templates = [MY_TPL, THEIR_TPL]
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: /Экспорт шаблонов/ }))
    expect(screen.queryByRole('button', { name: '+ Новый шаблон' })).toBeNull()
    fireEvent.click(screen.getByText('Спина').closest('button'))
    expect(screen.getByText('Спина').closest('button')).toHaveClass('picked')
    fireEvent.click(screen.getByRole('button', { name: '⬇ Скачать (1)' }))
    expect(exportTemplates).toHaveBeenCalledWith([THEIR_TPL], expect.any(String))
    expect(screen.getByRole('button', { name: '+ Новый шаблон' })).toBeInTheDocument()
  })
})

describe('TemplatesScreen — редактор', () => {
  let online
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('tpl_group_mine_me', '1')
    localStorage.setItem('tpl_group_shared_me', '1')
    mocks.templates = [MY_TPL, THEIR_TPL]
    mocks.exercises = [BENCH, PULL, PLANK]
    online = true
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
    vi.mocked(getTemplate).mockReset().mockImplementation(async (id) => [MY_TPL, THEIR_TPL].find((t) => t.id === id))
    vi.mocked(saveTemplate).mockReset().mockResolvedValue()
    vi.mocked(deleteTemplate).mockReset().mockResolvedValue()
    vi.mocked(syncNow).mockReset()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('новый: без упражнений и названия сохранить нельзя; подсказка про название', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: '+ Новый шаблон' }))
    expect(screen.getByRole('heading', { name: 'Новый шаблон' })).toBeInTheDocument()
    expect(screen.getByText('В шаблоне пока нет упражнений')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить упражнение' }))
    fireEvent.click(screen.getByRole('button', { name: 'выбрать Жим лежа' }))
    expect(screen.queryByTestId('picker')).toBeNull()
    expect(screen.getByText('Без названия шаблон не сохранится')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  })

  it('новый: дефолтный план по типу, правка, «Виден всем», сохранение + синк + выход', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: '+ Новый шаблон' }))
    fireEvent.change(screen.getByPlaceholderText(/Понедельник/), { target: { value: 'Фулбоди' } })
    for (const n of ['Жим лежа', 'Подтягивания', 'Планка']) {
      fireEvent.click(screen.getByRole('button', { name: '+ Добавить упражнение' }))
      fireEvent.click(screen.getByRole('button', { name: `выбрать ${n}` }))
    }
    // свой вес и время — без столбца «кг»
    expect(screen.getAllByText('кг')).toHaveLength(1)
    expect(screen.getAllByText('мин:сек')).toHaveLength(1)
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: '62,5' } }) // вес жима
    fireEvent.click(screen.getByRole('checkbox', { name: 'Виден всем' }))
    save()
    await waitFor(() => expect(saveTemplate).toHaveBeenCalledTimes(1))
    const doc = vi.mocked(saveTemplate).mock.calls[0][0]
    expect(doc).toMatchObject({ id: undefined, user_id: 'me', name: 'Фулбоди', is_public: true })
    expect(doc.exercises.map((e) => [e.exercise.id, e.sets, e.reps, e.weight])).toEqual([
      ['bench', 3, 10, '62.5'], ['pull', 3, 10, 0], ['plank', 3, 60, 0],
    ])
    expect(syncNow).toHaveBeenCalledWith('me')
    expect(await screen.findByRole('button', { name: '+ Новый шаблон' })).toBeInTheDocument()
  })

  it('дубль упражнения — короткая подсказка, которая гаснет сама', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      renderScreen()
      fireEvent.click(screen.getByRole('button', { name: '+ Новый шаблон' }))
      for (let i = 0; i < 2; i++) {
        fireEvent.click(screen.getByRole('button', { name: '+ Добавить упражнение' }))
        fireEvent.click(screen.getByRole('button', { name: 'выбрать Жим лежа' }))
      }
      expect(screen.getByText('Это упражнение уже в шаблоне')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Перетащить' })).toHaveLength(1)
      await act(() => vi.advanceTimersByTimeAsync(2500))
      expect(screen.queryByText('Это упражнение уже в шаблоне')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('свой шаблон: поля из документа, «убрать», правка сохраняется по id; офлайн — без синка', async () => {
    online = false
    renderScreen()
    fireEvent.click(screen.getByText('Грудь').closest('button'))
    expect(await screen.findByDisplayValue('Грудь')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Виден всем' })).toBeChecked()
    expect(screen.getByDisplayValue('60')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить упражнение' }))
    fireEvent.click(screen.getByRole('button', { name: 'выбрать Подтягивания' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'убрать' })[0])
    save()
    await waitFor(() => expect(saveTemplate).toHaveBeenCalled())
    const doc = vi.mocked(saveTemplate).mock.calls[0][0]
    expect(doc.id).toBe('t1')
    expect(doc.exercises.map((e) => e.exercise.id)).toEqual(['pull'])
    expect(syncNow).not.toHaveBeenCalled()
  })

  it('чужой общий шаблон — только просмотр', async () => {
    renderScreen()
    fireEvent.click(screen.getByText('Спина').closest('button'))
    expect(await screen.findByText(/только просмотр/)).toBeInTheDocument()
    expect(screen.getByText('от Петя')).toBeInTheDocument()
    expect(screen.getByText('3×10')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('шаблон не найден / сбой чтения — сообщение вместо вечного каркаса', async () => {
    vi.mocked(getTemplate).mockResolvedValueOnce(undefined)
    const { unmount } = renderScreen()
    fireEvent.click(screen.getByText('Грудь').closest('button'))
    expect(await screen.findByText('Шаблон не найден.')).toBeInTheDocument()
    unmount()
    vi.mocked(getTemplate).mockRejectedValueOnce(new Error('IDB'))
    renderScreen()
    fireEvent.click(screen.getByText('Грудь').closest('button'))
    expect(await screen.findByText('Не удалось открыть шаблон: IDB')).toBeInTheDocument()
    expect(screen.queryByLabelText('Загрузка')).toBeNull()
  })

  it('удаление — через подтверждение в приложении; отмена ничего не удаляет', async () => {
    renderScreen()
    fireEvent.click(screen.getByText('Грудь').closest('button'))
    await screen.findByDisplayValue('Грудь')
    fireEvent.click(screen.getByRole('button', { name: 'Удалить шаблон' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(deleteTemplate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить шаблон' }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, удалить' }))
    await waitFor(() => expect(deleteTemplate).toHaveBeenCalledWith('t1'))
    expect(syncNow).toHaveBeenCalledWith('me')
    expect(await screen.findByRole('button', { name: '+ Новый шаблон' })).toBeInTheDocument()
  })

  it('ошибка сохранения — баннер, редактор остается, можно повторить', async () => {
    vi.mocked(saveTemplate).mockRejectedValueOnce(new Error('quota'))
    renderScreen()
    fireEvent.click(screen.getByText('Грудь').closest('button'))
    await screen.findByDisplayValue('Грудь')
    save()
    expect(await screen.findByText('Не сохранилось: quota')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
  })

  it('перетаскивание за ручку меняет порядок упражнений', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: '+ Новый шаблон' }))
    fireEvent.change(screen.getByPlaceholderText(/Понедельник/), { target: { value: 'X' } })
    for (const n of ['Жим лежа', 'Подтягивания']) {
      fireEvent.click(screen.getByRole('button', { name: '+ Добавить упражнение' }))
      fireEvent.click(screen.getByRole('button', { name: `выбрать ${n}` }))
    }
    const rows = document.querySelectorAll('.tpl-row')
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ top: i * 100, bottom: i * 100 + 99 })
    })
    const handle = screen.getAllByRole('button', { name: 'Перетащить' })[0]
    // В jsdom нет PointerEvent: fireEvent.pointer* теряет clientY. MouseEvent с
    // типом pointer* React принимает как pointer-событие.
    const pointer = (type, clientY) => fireEvent(handle, new MouseEvent(type, { bubbles: true, cancelable: true, clientY }))
    pointer('pointerdown', 10)
    expect(rows[0]).toHaveClass('dragging')
    pointer('pointermove', 150)
    pointer('pointerup', 150)
    expect(document.querySelector('.tpl-row.dragging')).toBeNull()
    save()
    await waitFor(() => expect(saveTemplate).toHaveBeenCalled())
    expect(vi.mocked(saveTemplate).mock.calls[0][0].exercises.map((e) => e.exercise.id)).toEqual(['pull', 'bench'])
  })
})
