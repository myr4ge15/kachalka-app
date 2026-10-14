// @vitest-environment jsdom
// РЕВЬЮ-КОДА-2026-10-02: «Выйти» ждало до ~7 с без индикации.
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import LogoutButton from './LogoutButton.jsx'

describe('LogoutButton', () => {
  it('пока идет выход — «Выхожу…», disabled и без повторного вызова', async () => {
    let finish
    const onLogout = vi.fn(() => new Promise((r) => { finish = r }))
    render(<LogoutButton onLogout={onLogout} />)

    const btn = screen.getByRole('button', { name: 'Выйти' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(onLogout).toHaveBeenCalledOnce()
    expect(btn).toHaveTextContent('Выхожу…')
    expect(btn).toBeDisabled()

    await act(async () => { finish() })
    expect(btn).toHaveTextContent('Выйти')
    expect(btn).toBeEnabled()
  })

  it('сорвавшийся выход возвращает кнопку в рабочее состояние', async () => {
    const onLogout = vi.fn(() => Promise.reject(new Error('сеть')))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<LogoutButton onLogout={onLogout} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Выйти' }))
    })
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeEnabled()
  })
})
