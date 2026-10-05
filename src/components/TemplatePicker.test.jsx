// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import TemplatePicker from './TemplatePicker.jsx'

const mocks = vi.hoisted(() => ({ templates: undefined }))
// useLiveQuery → сразу текущее значение; getTemplates (Dexie) не нужен.
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => mocks.templates }))
vi.mock('../db/repo.js', () => ({ getTemplates: vi.fn() }))

const ME = { id: 'me' }
const BENCH = { id: 'bench', name: 'Жим лежа', metric: 'weight' }
const PULL = { id: 'pull', name: 'Подтягивания', metric: 'reps' }

function open() {
  const onPick = vi.fn()
  render(<TemplatePicker user={ME} onPick={onPick} onClose={vi.fn()} />)
  return { onPick }
}

describe('TemplatePicker', () => {
  beforeEach(() => { mocks.templates = undefined })

  it('пока база не ответила — «Загрузка…»', () => {
    open()
    expect(screen.getByText('Загрузка…')).toBeInTheDocument()
  })

  it('пусто — подсказка, где создать', () => {
    mocks.templates = []
    open()
    expect(screen.getByText(/Шаблонов пока нет/)).toBeInTheDocument()
  })

  it('делит на «Мои»/«Общие», метит свои общие 🌐 и автора чужих; тап отдает шаблон', () => {
    const mine = { id: 't1', user_id: 'me', name: 'Грудь', is_public: true,
      exercises: [{ exercise: BENCH, sets: 3, reps: 8, weight: 60 }, { exercise: null }] }
    const theirs = { id: 't2', user_id: 'x', name: 'Спина', author_name: 'Петя',
      exercises: [{ exercise: PULL }] }
    mocks.templates = [theirs, mine]
    const { onPick } = open()
    const titles = [...document.querySelectorAll('.group-title')].map((n) => n.textContent)
    expect(titles).toEqual(['Мои', 'Общие'])
    const items = screen.getAllByRole('button', { name: /упр\./ })
    expect(items[0]).toHaveTextContent('Грудь')
    expect(items[0]).toHaveTextContent('🌐 общий')
    expect(items[0]).toHaveTextContent('2 упр.')
    expect(items[0].querySelector('.tpl-pick-sub').textContent).toMatch(/^Жим лежа /) // пустое упражнение пропущено
    expect(items[1]).toHaveTextContent('· от Петя')
    expect(items[1]).not.toHaveTextContent('🌐')
    fireEvent.click(items[1])
    expect(onPick).toHaveBeenCalledWith(theirs)
  })
})
