// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import TemplatePicker from './TemplatePicker.jsx'

const mocks = vi.hoisted(() => ({ templates: undefined }))
// useLiveQuery → сразу текущее значение; getTemplates (Dexie) не нужен.
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => mocks.templates }))
vi.mock('../../db/repo.js', () => ({ getTemplates: vi.fn() }))

const ME = { id: 'me' }
const BENCH = { id: 'bench', name: 'Жим лежа', submuscle: 'chest_middle', metric: 'weight' }
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
    const myCard = screen.getByRole('button', { name: /Грудь.*виден всем/ })
    const otherCard = screen.getByRole('button', { name: /Спина.*от Петя/ })
    expect(myCard).toHaveTextContent('середина груди')
    expect(otherCard).not.toHaveTextContent('виден всем')
    expect(screen.queryByText('3×8×60 кг')).toBeNull()
    const details = screen.getByRole('button', { name: 'Состав шаблона «Грудь»' })
    expect(details).toHaveTextContent('2 упр.')
    fireEvent.click(details)
    expect(details).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('listitem').map(el => el.textContent.trim())).toEqual(['Жим лежа 3×8×60 кг'])
    fireEvent.click(details)
    expect(screen.queryByText('3×8×60 кг')).toBeNull()
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.click(otherCard)
    expect(onPick).toHaveBeenCalledWith(theirs)
  })
})
