// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

afterEach(() => vi.unstubAllEnvs())

it.each([['1', true], ['0', false]])('VITE_BETA=%s управляет меткой бета-сборки', async (value, visible) => {
  vi.stubEnv('VITE_BETA', value)
  vi.resetModules()
  const { default: AppMark } = await import('./AppMark.jsx')
  render(<AppMark />)
  if (visible) expect(screen.getByText('БЕТА')).toBeInTheDocument()
  else expect(screen.queryByText('БЕТА')).toBeNull()
})
