// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AchievementsScreen from './AchievementsScreen.jsx'
import { backfillBadges } from '../db/badges.js'

// Расчет бейджей — lib/badges.js и db/badges.js (свои тесты). Здесь — отрисовка вида.
const mocks = vi.hoisted(() => ({ view: undefined }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => mocks.view }))
vi.mock('../db/badges.js', () => ({ getBadgesView: vi.fn(), backfillBadges: vi.fn() }))

const W10 = { id: 'w10', cat: 'count', icon: '🏋️', name: '10 тренировок', desc: 'Десять' }
const W50 = { id: 'w50', cat: 'count', icon: '💯', name: '50 тренировок', desc: 'Полсотни' }
const VIEW = {
  earnedCount: 1, total: 3,
  next: { def: W50, remaining: 38 },
  cats: [{
    cat: 'count', icon: '📅', label: 'Регулярность', note: 'за все время', earnedCount: 1, total: 2,
    badges: [
      { def: W10, done: true, at: null },
      { def: W50, done: false, progress: { pct: 24, value: 12, target: 50 } },
    ],
  }],
}

describe('AchievementsScreen', () => {
  beforeEach(() => {
    mocks.view = undefined
    vi.mocked(backfillBadges).mockReset().mockResolvedValue()
  })

  it('загрузка — каркас; при входе тихо размечаются исторические вехи', () => {
    render(<AchievementsScreen user={{ id: 'me' }} onBack={vi.fn()} />)
    expect(screen.getByLabelText('Загрузка')).toBeInTheDocument()
    expect(backfillBadges).toHaveBeenCalledWith('me')
  })

  it('сводка, ближайшая веха, полученный и закрытый бейдж с прогрессом', () => {
    mocks.view = VIEW
    const { container } = render(<AchievementsScreen user={{ id: 'me' }} onBack={vi.fn()} />)
    expect(container.querySelector('.ach-big')).toHaveTextContent('1 из 3')
    expect(screen.getByText('33%')).toBeInTheDocument()
    expect(screen.getByText(/До «💯 50 тренировок» — еще 38/)).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByText('· за все время')).toBeInTheDocument()
    const [on, off] = container.querySelectorAll('.ach-badge')
    expect(on).toHaveClass('on')
    expect(on).toHaveTextContent('получено') // без даты — честное «получено»
    expect(off).toHaveClass('off')
    expect(off).toHaveTextContent('12 / 50')
    expect(off.querySelector('.ach-pb i').style.width).toBe('24%')
  })

  it('сбой разметки не роняет экран; «назад» работает', () => {
    vi.mocked(backfillBadges).mockRejectedValue(new Error('x'))
    mocks.view = { ...VIEW, next: null, total: 0, earnedCount: 0 }
    const onBack = vi.fn()
    render(<AchievementsScreen user={{ id: 'me' }} onBack={onBack} />)
    expect(screen.getByText('0%')).toBeInTheDocument() // total=0 — без деления на ноль
    fireEvent.click(screen.getByRole('button', { name: /назад/i }))
    expect(onBack).toHaveBeenCalled()
  })
})
