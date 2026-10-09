// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

let push
vi.mock('../hooks/usePushToggle.js', () => ({ usePushToggle: () => push }))
import PushSettingsScreen from './PushSettingsScreen.jsx'

const base = { availability: 'ok', enabled: true, busy: false, error: '', prefs: {}, prefsBusy: null, prefsError: '', toggle: vi.fn(), setType: vi.fn() }
const user = { id: 'u1' }

describe('PushSettingsScreen (v7.1.4)', () => {
  beforeEach(() => { push = { ...base, toggle: vi.fn(), setType: vi.fn() } })

  it('включены: тумблер устройства и пять типов', () => {
    render(<PushSettingsScreen user={user} onBack={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Пуш-уведомления' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /на это устройство/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('group', { name: /Какие уведомления/ })).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(6)
    fireEvent.click(screen.getByRole('switch', { name: /Реакции/ }))
    expect(push.setType).toHaveBeenCalledWith('reaction', false)
  })

  it('выключены: типов нет, подсказка; тумблер включает', () => {
    push.enabled = false
    render(<PushSettingsScreen user={user} onBack={() => {}} />)
    expect(screen.queryByRole('group', { name: /Какие уведомления/ })).toBeNull()
    expect(screen.getByText(/Включи/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: /на это устройство/ }))
    expect(push.toggle).toHaveBeenCalledWith(true)
  })

  it('включить нельзя (iPhone во вкладке) — объяснение без типов', () => {
    push = { ...push, availability: 'ios-install', enabled: false }
    render(<PushSettingsScreen user={user} onBack={() => {}} />)
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.getByText(/Поделиться/)).toBeInTheDocument()
  })

  it('«Назад»', () => {
    const onBack = vi.fn()
    render(<PushSettingsScreen user={user} onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: /Назад/ }))
    expect(onBack).toHaveBeenCalled()
  })
})
