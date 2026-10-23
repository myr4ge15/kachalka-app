// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import FreshnessScreen from './FreshnessScreen.jsx'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('../db/insights.js', () => ({ getFreshness: vi.fn() }))
vi.mock('../db/repo.js', () => ({ getWorkouts: vi.fn() }))

// Бицепс давно не тренирован (группа-цель), широчайшие отдыхают.
const data = {
  sex: 'm',
  recovery: [{ group: 'бицепс', bucket: 'overdue', state: 'ready', daysSince: 9 }],
  recoverySub: [
    { submuscle: 'biceps', major: 'бицепс', daysSince: 9, state: 'ready' },
    { submuscle: 'lats', major: 'спина', daysSince: 1, state: 'resting', recoveryHours: 72, hoursSince: 24 },
  ],
  imbalanceSub: [],
}

describe('FreshnessScreen «Восстановление» (v6.3.5)', () => {
  // Второй useLiveQuery (объем по группам) — с дефолтом []; первый (готовность) — без.
  beforeEach(() => vi.mocked(useLiveQuery).mockImplementation((fn, deps, def) => (def === undefined ? data : [])))

  it('заголовок экрана — «Восстановление»', () => {
    render(<FreshnessScreen user={{ id: 'u1' }} onBack={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Восстановление' })).toBeInTheDocument()
  })

  // v8.8.0 (решение владельца 15.10): при входе ничего не подсвечено — ни мышца, ни
  // зона на карте; группа-цель подсвечивается только по нажатию на подсказку.
  it('при входе ничего не подсвечено; нажатие на группу-цель подсказки подсвечивает ее мышцы', () => {
    render(<FreshnessScreen user={{ id: 'u1' }} onBack={() => {}} />)
    expect(document.querySelector('.fr-chip.hl')).toBeNull()
    expect(document.querySelector('.fr-chip.on')).toBeNull()
    expect(document.querySelector('.fr-detail')).toHaveTextContent(/^Нажми на мышцу/)
    fireEvent.click(document.querySelector('.fr-tip-target'))
    expect(document.querySelector('.fr-tip-target')).toHaveTextContent('бицепс')
    expect(document.querySelector('.fr-chip.hl')).toHaveTextContent('бицепс')
  })

  it('строка деталей не повторяет группу, совпавшую с названием мышцы', () => {
    render(<FreshnessScreen user={{ id: 'u1' }} onBack={() => {}} />)
    fireEvent.click(document.querySelector('.fr-tip-target'))
    fireEvent.click(document.querySelector('.fr-chip.hl'))
    const detail = document.querySelector('.fr-detail').textContent
    expect(detail).toMatch(/^Бицепс · /)
    expect(detail).not.toMatch(/бицепс · бицепс/i)
  })

  it('у мышцы с другой группой группа в деталях остается', () => {
    render(<FreshnessScreen user={{ id: 'u1' }} onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /отдыхают/ }))
    fireEvent.click([...document.querySelectorAll('.fr-chip')].find((el) => /широчайшие/.test(el.textContent)))
    expect(document.querySelector('.fr-detail')).toHaveTextContent(/Широчайшие · спина · /)
  })

  // v7.5.5: открыта «можно», а нажатая на рисунке мышца отдыхает — раньше она
  // подсвечивалась на карте, но в списке и деталях ее не было.
  it('нажатие на мышцу рисунка открывает ее корзину и показывает детали', () => {
    render(<FreshnessScreen user={{ id: 'u1' }} onBack={() => {}} />)
    expect(screen.getByRole('button', { name: /можно/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getAllByRole('button', { name: 'широчайшие' })[0])
    expect(screen.getByRole('button', { name: /отдыхают/ })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('.fr-chip.on')).toHaveTextContent('широчайшие')
    expect(document.querySelector('.fr-detail')).toHaveTextContent(/^Широчайшие · спина · /)
    // повторное нажатие снимает выбор
    fireEvent.click(screen.getAllByRole('button', { name: 'широчайшие' })[0])
    expect(document.querySelector('.fr-chip.on')).toBeNull()
  })

  it('подсказка без рода глагола; кардио — отдельной строкой (v7.5.6)', () => {
    vi.mocked(useLiveQuery).mockImplementation((fn, deps, def) => (def === undefined ? { ...data, cardio: 8 } : []))
    render(<FreshnessScreen user={{ id: 'u1' }} onBack={() => {}} />)
    const tip = document.querySelector('.fr-tip')
    expect(tip).toHaveTextContent('Пора проработать бицепс — последний раз 9 дней назад')
    expect(tip).not.toHaveTextContent('тренировал')
    expect(document.querySelector('.fr-tip-cardio')).toHaveTextContent('Кардио не было 8 дней')
  })

  it('мышца без данных — так и пишем', () => {
    render(<FreshnessScreen user={{ id: 'u1' }} onBack={() => {}} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'трапеция' })[0])
    expect(document.querySelector('.fr-detail')).toHaveTextContent('Трапеция · нет данных: не тренировал ни разу')
  })
})

describe('FreshnessScreen — объём по группам (v6.5.0)', () => {
  const rows = [
    { group: 'грудь', weeks: [3, 4, 6, 6], recent: 12, prev: 7, perWeek: 6, trend: 'up', pct: 71 },
    { group: 'спина', weeks: [5, 5, 2, 2], recent: 4, prev: 10, perWeek: 2, trend: 'down', pct: -60 },
  ]
  beforeEach(() => vi.mocked(useLiveQuery).mockImplementation((fn, deps, def) => (def === undefined ? data : rows)))

  it('строка на группу: подходы в неделю и тренд', () => {
    render(<FreshnessScreen user={{ id: 'u1' }} onBack={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Объем по группам' })).toBeInTheDocument()
    const items = [...document.querySelectorAll('.gv-row')].map((el) => el.textContent)
    expect(items[0]).toMatch(/Грудь.*6 подходов\/нед\..*▲ \+71%/)
    expect(items[1]).toMatch(/Спина.*2 подхода\/нед\..*▼ −60%/)
  })
})
