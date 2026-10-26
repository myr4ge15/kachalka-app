// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import TemplatesScreen from './TemplatesScreen.jsx'
import Toast from '../components/ui/Toast.jsx'
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
vi.mock('../components/exercises/ExercisePicker.jsx', () => ({
  default: ({ exercises, onPick, onPickMany, onClose }) => (
    <div data-testid="picker">
      {exercises.map((e) => <button key={e.id} onClick={() => onPick(e)}>выбрать {e.name}</button>)}
      {onPickMany && <button onClick={() => onPickMany([...exercises].reverse())}>набор сканером</button>}
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
// Группы при входе свернуты (fb_88be7eab); expand — раскрыть обе, как сделал бы человек.
let expand = false
const renderScreen = (props = {}) => {
  onBack = vi.fn()
  const r = render(<TemplatesScreen user={ME} onBack={onBack} {...props} />)
  if (expand) for (const name of [/Мои шаблоны/, /Общие шаблоны/]) {
    const b = screen.queryByRole('button', { name })
    if (b?.getAttribute('aria-expanded') === 'false') fireEvent.click(b)
  }
  return r
}
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

describe('TemplatesScreen — список', () => {
  beforeEach(() => {
    localStorage.clear()
    expand = false
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

  it('группы свернуты при каждом входе — раскрытие не запоминается (fb_88be7eab)', () => {
    localStorage.setItem('tpl_group_mine_me', '1') // след старых версий — не действует
    mocks.templates = [MY_TPL, THEIR_TPL]
    const { unmount } = renderScreen()
    const mine = screen.getByRole('button', { name: /Мои шаблоны/ })
    expect(mine).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Грудь')).toBeNull()
    fireEvent.click(mine)
    expect(screen.getByText('Грудь')).toBeInTheDocument()
    unmount()
    renderScreen()
    expect(screen.getByRole('button', { name: /Мои шаблоны/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /Общие/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('карточки: свой общий — 🌐 и «ждет синка», чужой — автор; план упражнения', () => {
    mocks.templates = [MY_TPL, THEIR_TPL]
    expand = true
    renderScreen()
    const mine = screen.getByText('Грудь').closest('button')
    expect(mine).toHaveTextContent('🌐 виден всем')
    expect(within(mine).getByTitle('Ждет синхронизации')).toBeInTheDocument()
    // Состав таблетками (fb_966c7e2b): число подходов отдельно, одинаковые подходы — одной таблеткой.
    expect(within(mine).getByText('4 подхода')).toBeInTheDocument()
    expect(within(mine).getAllByText('60×8')).toHaveLength(1)
    // Чужой шаблон не открывается (fb_150a4d25): карточка — не кнопка, весь состав виден в ней.
    const theirs = screen.getByText('Спина').closest('.tpl-card')
    expect(theirs.tagName).toBe('DIV')
    expect(theirs).toHaveTextContent('· от Петя')
    expect(theirs).not.toHaveTextContent('🌐')
  })

  it('экспорт: выбор карточек вместо открытия, «Скачать» отдает выбранные', () => {
    mocks.templates = [MY_TPL, THEIR_TPL]
    expand = true
    const onSelectModeChange = vi.fn()
    renderScreen({ onSelectModeChange })
    expect(onSelectModeChange).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: /Скачать шаблоны/ }))
    expect(onSelectModeChange).toHaveBeenLastCalledWith(true)
    expect(screen.queryByRole('button', { name: '+ Новый шаблон' })).toBeNull()
    fireEvent.click(screen.getByText('Спина').closest('button'))
    expect(screen.getByText('Спина').closest('button')).toHaveClass('picked')
    fireEvent.click(screen.getByRole('button', { name: 'Скачать (1)' }))
    expect(exportTemplates).toHaveBeenCalledWith([THEIR_TPL], expect.any(String))
    expect(screen.getByRole('button', { name: '+ Новый шаблон' })).toBeInTheDocument()
    expect(onSelectModeChange).toHaveBeenLastCalledWith(false)
  })

  it('«Скачать» при свернутых группах показывает карточки — есть что выбирать (UI-ревью 23.10)', () => {
    mocks.templates = [MY_TPL, THEIR_TPL]
    renderScreen()
    expect(screen.queryByText('Спина')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Скачать шаблоны/ }))
    expect(screen.getByText('Грудь')).toBeInTheDocument()
    expect(screen.getByText('Спина')).toBeInTheDocument()
  })
})

describe('TemplatesScreen — редактор', () => {
  let online
  beforeEach(() => {
    localStorage.clear()
    expand = true
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
    // подписи столбцов — один раз на упражнение, как в тренировке; у времени нет «кг»
    expect(screen.getAllByText('кг')).toHaveLength(1)
    expect(screen.getAllByText('±кг')).toHaveLength(1)
    expect(screen.getAllByText('мин:сек')).toHaveLength(1)
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: '62,5' } }) // вес жима
    fireEvent.click(screen.getByRole('checkbox', { name: 'Виден всем' }))
    save()
    await waitFor(() => expect(saveTemplate).toHaveBeenCalledTimes(1))
    const doc = vi.mocked(saveTemplate).mock.calls[0][0]
    expect(doc).toMatchObject({ id: undefined, user_id: 'me', name: 'Фулбоди', is_public: true })
    expect(doc.exercises.map((e) => [e.exercise.id, e.set_plan.length])).toEqual([['bench', 3], ['pull', 3], ['plank', 3]])
    expect(doc.exercises[0].set_plan.map((s) => [s.weight, s.reps])).toEqual([['62.5', 10], [0, 10], [0, 10]])
    expect(doc.exercises[2].set_plan.every((s) => s.reps === 60)).toBe(true)
    expect(syncNow).toHaveBeenCalledWith('me')
    expect(await screen.findByRole('button', { name: '+ Новый шаблон' })).toBeInTheDocument()
  })

  it('каждый подход редактируется отдельно, степперами, добавляется и удаляется', async () => {
    vi.mocked(getTemplate).mockResolvedValueOnce({ ...MY_TPL, exercises: [{ exercise: BENCH, metric: 'weight',
      set_plan: [{ weight: 20, reps: 15 }, { weight: 80, reps: 8 }, { weight: 70, reps: 10 }] }] })
    renderScreen()
    fireEvent.click(screen.getByText('Грудь').closest('button'))
    await screen.findByDisplayValue('Грудь')
    fireEvent.change(screen.getByLabelText('Вес или дистанция подхода 2'), { target: { value: '82,5' } })
    fireEvent.change(screen.getByLabelText('Повторы подхода 2'), { target: { value: '7' } })
    // Степпер как в тренировке: + к весу первого подхода — шаг 1,25 кг.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Больше, подход 1' }))
    fireEvent.pointerUp(screen.getByRole('button', { name: 'Больше, подход 1' }))
    expect(screen.getByLabelText('Вес или дистанция подхода 1')).toHaveValue('21,25')
    fireEvent.click(screen.getByRole('button', { name: 'Удалить подход 3' }))
    fireEvent.click(screen.getByRole('button', { name: '+ подход (повтор предыдущего)' }))
    save()
    await waitFor(() => expect(saveTemplate).toHaveBeenCalled())
    expect(vi.mocked(saveTemplate).mock.calls[0][0].exercises[0].set_plan.map(({ weight, reps }) => ({ weight, reps }))).toEqual([
      { weight: 21.25, reps: 15 }, { weight: '82.5', reps: '7' }, { weight: '82.5', reps: '7' },
    ])
  })

  it('время каждого подхода меняется в минутах и секундах', async () => {
    vi.mocked(getTemplate).mockResolvedValueOnce({ ...MY_TPL, exercises: [{ exercise: PLANK, metric: 'time',
      set_plan: [{ weight: 0, reps: 60 }, { weight: 0, reps: 90 }] }] })
    renderScreen()
    fireEvent.click(screen.getByText('Грудь').closest('button'))
    await screen.findByDisplayValue('Грудь')
    fireEvent.change(screen.getByLabelText('Время подхода 2'), { target: { value: '2:15' } })
    save()
    await waitFor(() => expect(saveTemplate).toHaveBeenCalled())
    expect(vi.mocked(saveTemplate).mock.calls[0][0].exercises[0].set_plan.map((s) => s.reps)).toEqual([60, 135])
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

  it('набор сканером: все разом в порядке сканирования, уже стоящие пропускаются', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: '+ Новый шаблон' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить упражнение' }))
    fireEvent.click(screen.getByRole('button', { name: 'выбрать Жим лежа' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить упражнение' }))
    fireEvent.click(screen.getByRole('button', { name: 'набор сканером' }))
    expect(screen.queryByTestId('picker')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Перетащить' })).toHaveLength(3)
    expect(screen.getByText('Уже были в шаблоне: 1')).toBeInTheDocument()
  })

  it('свой шаблон: поля из документа, «убрать», правка сохраняется по id; офлайн — без синка', async () => {
    online = false
    renderScreen()
    fireEvent.click(screen.getByText('Грудь').closest('button'))
    expect(await screen.findByDisplayValue('Грудь')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Виден всем' })).toBeChecked()
    expect(screen.getAllByDisplayValue('60')).toHaveLength(4)
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

  // UI-ревью 23.10: «убрать» стирает построчный план — есть «Отменить», как в тренировке.
  it('«убрать» упражнение — тост «Отменить» возвращает его на место', async () => {
    online = false
    render(<Toast />)
    renderScreen()
    fireEvent.click(screen.getByText('Грудь').closest('button'))
    expect(await screen.findByDisplayValue('Грудь')).toBeInTheDocument()
    const before = screen.getAllByRole('button', { name: 'убрать' }).length
    fireEvent.click(screen.getAllByRole('button', { name: 'убрать' })[0])
    expect(screen.queryAllByRole('button', { name: 'убрать' })).toHaveLength(before - 1)
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить' }))
    expect(screen.getAllByRole('button', { name: 'убрать' })).toHaveLength(before)
    save()
    await waitFor(() => expect(saveTemplate).toHaveBeenCalled())
    expect(vi.mocked(saveTemplate).mock.calls[0][0].exercises).toHaveLength(before)
  })

  // fb_150a4d25: внутри был тот же состав только для чтения — теперь он весь в карточке.
  it('чужой общий шаблон не открывается: состав виден в карточке', async () => {
    renderScreen()
    fireEvent.click(screen.getByText('Спина').closest('.tpl-card'))
    expect(within(screen.getByText('Спина').closest('.tpl-card')).getByText('3 подхода')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Шаблон' })).toBeNull()
    expect(getTemplate).not.toHaveBeenCalled()
  })

  // fb_ae7bdcb1: список не пересоздается на время редактора — после «назад» он на том же месте.
  it('список остается смонтированным (скрыт) под редактором и снова виден после «назад»', async () => {
    renderScreen()
    const listLayer = screen.getByText('Грудь').closest('.nav-layer')
    fireEvent.click(screen.getByText('Грудь').closest('button'))
    await screen.findByDisplayValue('Грудь')
    expect(listLayer).toBeInTheDocument()
    expect(listLayer).toHaveClass('nav-hidden')
    expect(listLayer).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(screen.getAllByRole('button', { name: /Назад/ })[0])
    expect(screen.getByText('Грудь').closest('.nav-layer')).toBe(listLayer)
    expect(listLayer).toHaveClass('nav-current')
  })

  it('«назад» с несохраненной правкой спрашивает; «Остаться» держит редактор, «Выйти» уходит', async () => {
    renderScreen()
    fireEvent.click(screen.getByText('Грудь').closest('button'))
    await screen.findByDisplayValue('Грудь')
    const back = () => fireEvent.click(screen.getAllByRole('button', { name: /Назад/ })[0])
    // Без правок — уходит сразу.
    back()
    expect(screen.queryByDisplayValue('Грудь')).toBeNull()
    fireEvent.click(screen.getByText('Грудь').closest('button'))
    fireEvent.change(await screen.findByDisplayValue('Грудь'), { target: { value: 'Грудь 2' } })
    back()
    expect(screen.getByText(/Выйти без сохранения/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Остаться' }))
    expect(screen.getByDisplayValue('Грудь 2')).toBeInTheDocument()
    back()
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }))
    expect(screen.queryByDisplayValue('Грудь 2')).toBeNull()
    expect(saveTemplate).not.toHaveBeenCalled()
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
    // «Удалить» — у заголовка (fb_ff55a5d2)
    fireEvent.click(screen.getByRole('button', { name: 'Удалить', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(deleteTemplate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить', exact: true }))
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
    window.matchMedia = vi.fn(() => ({ matches: true })) // без анимации приземления
    const rows = [...document.querySelectorAll('.tpl-ex')]
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ top: i * 110, height: 100, bottom: i * 110 + 100 })
    })
    const handle = screen.getAllByRole('button', { name: 'Перетащить' })[0]
    fireEvent.touchStart(handle, { touches: [{ clientX: 5, clientY: 10 }] })
    expect(rows[0]).toHaveClass('sort-lifted')
    fireEvent.touchMove(handle, { touches: [{ clientX: 5, clientY: 150 }] })
    expect(rows[1].style.transform).toBe('translate3d(0, -110px, 0)') // соседка уступила место
    fireEvent.touchEnd(handle)
    expect(document.querySelector('.tpl-ex.sort-lifted')).toBeNull()
    save()
    await waitFor(() => expect(saveTemplate).toHaveBeenCalled())
    expect(vi.mocked(saveTemplate).mock.calls[0][0].exercises.map((e) => e.exercise.id)).toEqual(['pull', 'bench'])
    delete window.matchMedia
  })
})
