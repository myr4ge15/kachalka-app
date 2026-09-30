// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AppearanceScreen from './AppearanceScreen.jsx'
import { ACCENT_KEY } from '../lib/accent.js'

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

  it('поднимает сохранённый выбор и уходит назад', () => {
    const onBack = vi.fn()
    render(<AppearanceScreen onBack={onBack} storage={memStorage('{"id":"custom","hue":290}')} root={document.createElement('div')} />)
    expect(screen.getByRole('radio', { name: 'Свой' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Оттенок своего цвета')).toHaveValue('290')
    fireEvent.click(screen.getByText('‹ Назад'))
    expect(onBack).toHaveBeenCalled()
  })
})
