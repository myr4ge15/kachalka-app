// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { fmtHomeTitle } from '../lib/dates.js'
import HomeScreen from './HomeScreen.jsx'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('../db/insights.js', () => ({ getHomeData: vi.fn() }))

const user = { id: 'u1', name: 'Саня' }
const scrollIntoView = vi.fn()
const readyHome = {
  summary: {
    hasData: true,
    tonnage: { month: 1000, pct: 10 },
    lastWorkout: { daysAgo: 1, tags: [] },
    streak: 2,
    workouts30: 3,
    latestPr: null,
    nearestGoal: null,
    rhythm: Array.from({ length: 8 }, (_, i) => ({
      key: `2026-0${i + 1}-06`,
      start: i === 7 ? '2026-07-27' : `2026-0${i + 1}-06`,
      end: i === 7 ? '2026-08-02' : `2026-0${i + 1}-12`,
      current: i === 7,
      beforeFirst: i !== 7,
      count: i === 7 ? 1 : 0,
      days: Array.from({ length: 7 }, (_, d) => ({
        day: i === 7 ? `2026-07-${String(27 + d).padStart(2, '0')}` : `2026-0${i + 1}-${String(6 + d).padStart(2, '0')}`,
        count: i === 7 && d === 2 ? 1 : 0,
        tags: i === 7 && d === 2 ? ['chest_middle'] : [],
        today: i === 7 && d === 3,
        future: i === 7 && d > 3,
      })),
    })),
  },
  insights: [{
    id: 'past',
    kind: 'past-self',
    exerciseId: 'bench',
    emoji: '💪',
    tone: 'good',
    text: 'Жим лежа: 70 → 85 кг при 6 повт. — +21% за год',
  }],
  freshness: { recovery: [] },
}

describe('HomeScreen', () => {
  beforeEach(() => {
    vi.mocked(useLiveQuery).mockReset()
    scrollIntoView.mockReset()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    })
  })

  it('показывает инсайт «себя прошлого» и ведет в Прогресс', () => {
    vi.mocked(useLiveQuery).mockReturnValue(readyHome)
    const onNavigate = vi.fn()
    const onOpenProgress = vi.fn()
    const onNewWorkout = vi.fn()
    render(<HomeScreen user={user} onNavigate={onNavigate} onOpenProgress={onOpenProgress} onNewWorkout={onNewWorkout} />)

    fireEvent.click(screen.getByRole('button', { name: /Начать тренировку/ }))
    expect(onNewWorkout).toHaveBeenCalledOnce()
    expect(screen.getByText('27.07')).toBeInTheDocument()
    expect(screen.queryByText('эта')).toBeNull()
    // 7 недель до первой тренировки не в счет — итог за эту неделю, не «0,1 в неделю»
    expect(screen.getByText(/на этой неделе/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Жим лежа: 70 → 85 кг при 6 повт. — +21% за год' }))
    expect(onOpenProgress).toHaveBeenCalledWith('bench')
    // Быстрые кнопки «Прогресс/Лента» убраны в v6.0.3 — это есть в нижнем меню.
    expect(screen.queryByRole('button', { name: 'Прогресс' })).toBeNull()
    const currentWeek = screen.getByRole('button', { name: /27 июл – 2 авг: 1 тренировка/ })
    fireEvent.click(currentWeek)
    expect(screen.getByText('29 июля')).toBeInTheDocument()
    expect(screen.getByText(/середина груди/)).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Открыть в календаре' }))
    expect(onNavigate).toHaveBeenCalledWith('history')
  })

  it('заголовок — сегодняшняя дата, а не приветствие; «Открыть в календаре» передает день недели', () => {
    vi.mocked(useLiveQuery).mockReturnValue(readyHome)
    const onOpenCalendar = vi.fn()
    render(<HomeScreen user={user} onOpenCalendar={onOpenCalendar} />)
    expect(screen.queryByText(/Привет/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: fmtHomeTitle() })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть в календаре' }))
    expect(onOpenCalendar).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByRole('button', { name: /27 июл – 2 авг: 1 тренировка/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Открыть в календаре' }))
    expect(onOpenCalendar).toHaveBeenLastCalledWith('2026-07-29')
  })

  it('v6.5.1: тренировки в плитке — за 30 дней; пояснение Ритма по кнопке «Как читать график»', () => {
    vi.mocked(useLiveQuery).mockReturnValue(readyHome)
    render(<HomeScreen user={user} onNavigate={vi.fn()} />)
    expect(screen.getByText(/3 трен\. за 30 дн\./)).toBeInTheDocument()
    expect(screen.queryByText(/Один столбик — одна неделя/)).toBeNull()
    const help = screen.getByRole('button', { name: /Как читать график/ })
    expect(help).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(help)
    expect(screen.getByText(/Один столбик — одна неделя/)).toBeInTheDocument()
  })

  it('v6.5.1: «Последний рекорд» не дублирует рекорд из «Наблюдений»', () => {
    const latestPr = { name: 'Жим стоя', metric: 'weight', value: 69 }
    const prInsight = { id: 'pr', kind: 'pr', emoji: '🏆', tone: 'good', text: 'Новый рекорд: Жим стоя — 69 кг (было 55 кг)' }
    vi.mocked(useLiveQuery).mockReturnValue({ ...readyHome, summary: { ...readyHome.summary, latestPr }, insights: [prInsight] })
    const { unmount } = render(<HomeScreen user={user} onNavigate={vi.fn()} />)
    expect(screen.queryByText('Последний рекорд')).toBeNull()
    unmount()
    vi.mocked(useLiveQuery).mockReturnValue({ ...readyHome, summary: { ...readyHome.summary, latestPr } })
    render(<HomeScreen user={user} onNavigate={vi.fn()} />)
    expect(screen.getByText('Последний рекорд')).toBeInTheDocument()
  })

  it('в пустом состоянии дает прямой вход в новую тренировку', () => {
    vi.mocked(useLiveQuery).mockReturnValue({
      summary: { hasData: false },
      insights: [],
      freshness: { recovery: [] },
    })
    const onNewWorkout = vi.fn()
    render(<HomeScreen user={user} onNewWorkout={onNewWorkout} />)

    expect(screen.getByText('Начни с первой тренировки')).toBeInTheDocument()
    expect(screen.getByText(/пора нагрузить/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ Записать тренировку' }))
    expect(onNewWorkout).toHaveBeenCalledOnce()
  })
})
