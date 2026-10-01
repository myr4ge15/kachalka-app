// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import FreshnessScreen from './FreshnessScreen.jsx'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('../db/insights.js', () => ({ getFreshness: vi.fn() }))

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
  beforeEach(() => vi.mocked(useLiveQuery).mockReturnValue(data))

  it('заголовок экрана — «Восстановление»', () => {
    render(<FreshnessScreen user={{ id: 'u1' }} onBack={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Восстановление' })).toBeInTheDocument()
  })

  it('группа-цель из подсказки подсвечивает свои мышцы сразу', () => {
    render(<FreshnessScreen user={{ id: 'u1' }} onBack={() => {}} />)
    expect(document.querySelector('.fr-tip-target')).toHaveTextContent('бицепс')
    expect(document.querySelector('.fr-chip.hl')).toHaveTextContent('бицепс')
  })

  it('строка деталей не повторяет группу, совпавшую с названием мышцы', () => {
    render(<FreshnessScreen user={{ id: 'u1' }} onBack={() => {}} />)
    fireEvent.click(document.querySelector('.fr-chip.hl'))
    const detail = document.querySelector('.fr-detail').textContent
    expect(detail).toMatch(/^Бицепс · /)
    expect(detail).not.toMatch(/бицепс · бицепс/i)
  })

  it('у мышцы с другой группой группа в деталях остается', () => {
    render(<FreshnessScreen user={{ id: 'u1' }} onBack={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: /отдыхают/ }))
    fireEvent.click([...document.querySelectorAll('.fr-chip')].find((el) => /широчайшие/.test(el.textContent)))
    expect(document.querySelector('.fr-detail')).toHaveTextContent(/Широчайшие · спина · /)
  })
})
