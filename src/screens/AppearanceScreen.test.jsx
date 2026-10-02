// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import AppearanceScreen, { ACCENT_SAVE_DEBOUNCE_MS } from './AppearanceScreen.jsx'
import { ACCENT_KEY } from '../lib/accent.js'
import { setAccentPref } from '../db/repo.js'

vi.mock('../db/repo.js', () => ({ setAccentPref: vi.fn(() => Promise.resolve()) }))

function memStorage(init) {
  const m = new Map(init ? [[ACCENT_KEY, init]] : [])
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), map: m }
}

describe('AppearanceScreen', () => {
  it('по умолчанию выбран вольт', () => {
    render(<AppearanceScreen onBack={() => {}} storage={memStorage()} root={document.createElement('div')} />)
    expect(screen.getByRole('radio', { name: 'Вольт' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByRole('radio')).toHaveLength(8)
  })

  it('выбор готового акцента применяется и сохраняется', () => {
    const st = memStorage()
    const root = document.createElement('div')
    render(<AppearanceScreen onBack={() => {}} storage={st} root={root} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Персик' }))
    expect(root.dataset.accent).toBe('peach')
    expect(JSON.parse(st.map.get(ACCENT_KEY))).toEqual({ id: 'peach', hue: 200 })
    expect(screen.getByRole('radio', { name: 'Персик' })).toHaveAttribute('aria-checked', 'true')
  })

  it('ползунок включает «свой оттенок», в красной зоне — предупреждение', () => {
    const st = memStorage()
    const root = document.createElement('div')
    render(<AppearanceScreen onBack={() => {}} storage={st} root={root} />)
    const range = screen.getByLabelText('Оттенок своего цвета')
    fireEvent.change(range, { target: { value: '150' } })
    expect(root.dataset.accent).toBe('custom')
    expect(root.style.getPropertyValue('--acc')).toBe('oklch(0.79 0.19 150)')
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.change(range, { target: { value: '10' } })
    expect(screen.getByRole('status')).toHaveTextContent('Похож на цвет ошибок')
    expect(JSON.parse(st.map.get(ACCENT_KEY))).toEqual({ id: 'custom', hue: 10 })
  })

  it('поднимает сохраненный выбор и уходит назад', () => {
    const onBack = vi.fn()
    render(<AppearanceScreen onBack={onBack} storage={memStorage('{"id":"custom","hue":290}')} root={document.createElement('div')} />)
    expect(screen.getByRole('radio', { name: 'Свой' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Оттенок своего цвета')).toHaveValue('290')
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(onBack).toHaveBeenCalled()
  })

  // РЕВЬЮ-КОДА-2026-10-02: ползунок писал в базу на каждый тик.
  describe('запись «своего оттенка» в учетку', () => {
    afterEach(() => { vi.useRealTimers(); vi.mocked(setAccentPref).mockClear() })

    it('применяет сразу, а в базу пишет только последнее значение после паузы', () => {
      vi.useFakeTimers()
      const root = document.createElement('div')
      render(<AppearanceScreen onBack={() => {}} user={{ id: 'u1' }} storage={memStorage()} root={root} />)
      const range = screen.getByLabelText('Оттенок своего цвета')
      for (const v of ['100', '120', '140']) fireEvent.change(range, { target: { value: v } })
      expect(root.style.getPropertyValue('--acc')).toBe('oklch(0.79 0.19 140)')
      expect(setAccentPref).not.toHaveBeenCalled()

      act(() => { vi.advanceTimersByTime(ACCENT_SAVE_DEBOUNCE_MS) })
      expect(setAccentPref).toHaveBeenCalledOnce()
      expect(setAccentPref).toHaveBeenCalledWith('u1', { id: 'custom', hue: 140 })
    })

    it('уход с экрана посреди паузы дописывает последнее значение', () => {
      vi.useFakeTimers()
      const { unmount } = render(<AppearanceScreen onBack={() => {}} user={{ id: 'u1' }} storage={memStorage()} root={document.createElement('div')} />)
      fireEvent.change(screen.getByLabelText('Оттенок своего цвета'), { target: { value: '77' } })
      unmount()
      expect(setAccentPref).toHaveBeenCalledOnce()
      expect(setAccentPref).toHaveBeenCalledWith('u1', { id: 'custom', hue: 77 })
      act(() => { vi.advanceTimersByTime(ACCENT_SAVE_DEBOUNCE_MS * 2) })
      expect(setAccentPref).toHaveBeenCalledOnce()
    })

    it('готовый акцент пишется сразу', () => {
      render(<AppearanceScreen onBack={() => {}} user={{ id: 'u1' }} storage={memStorage()} root={document.createElement('div')} />)
      fireEvent.click(screen.getByRole('radio', { name: 'Персик' }))
      expect(setAccentPref).toHaveBeenCalledWith('u1', { id: 'peach', hue: 200 })
    })
  })
})
