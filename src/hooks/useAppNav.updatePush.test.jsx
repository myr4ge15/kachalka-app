// @vitest-environment jsdom
// Обращение 19.10.2026: пуш «вышла версия» нажали у свернутой PWA на iPhone — нажатие дошло
// только записью в кэше (takePendingPushUrl / takeTappedPushUrl), а навигация намерение update
// игнорировала, и человек оставался в приложении. Теперь любой путь ведет на сплэш обновления.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('../lib/appEvents.js', () => ({ emitReselect: vi.fn(), onResume: vi.fn(() => () => {}) }))
vi.mock('./useEdgeSwipeBack.js', async (orig) => ({ ...(await orig()), useEdgeSwipeBack: vi.fn() }))
vi.mock('../lib/launchUpdate.js', () => ({ reloadForUpdatePush: vi.fn(async () => 'reload') }))
const pending = { url: null }
vi.mock('../lib/pushIntent.js', async (orig) => ({
  ...(await orig()),
  appendPushLog: vi.fn(),
  takePendingPushUrl: vi.fn(async () => { const u = pending.url; pending.url = null; return u }),
  takeTappedPushUrl: vi.fn(async () => null),
}))
import { useAppNav } from './useAppNav.js'
import { reloadForUpdatePush } from '../lib/launchUpdate.js'

const ME = { id: 'me', name: 'Саня' }
afterEach(() => { vi.mocked(reloadForUpdatePush).mockClear(); delete document.documentElement.dataset.composer })

describe('useAppNav: пуш «вышла новая версия» у запущенного приложения', () => {
  it('нажатие из записи SW в кэше — на сплэш обновления, вкладка не меняется', async () => {
    pending.url = 'https://x/kachalka-app/?push=update'
    const { result } = renderHook(() => useAppNav(ME))
    await waitFor(() => expect(reloadForUpdatePush).toHaveBeenCalledTimes(1))
    expect(reloadForUpdatePush.mock.calls[0][0]).toMatchObject({ currentVersion: __APP_VERSION__, composerOpen: false })
    expect(result.current.tab).toBe('home')
  })

  it('посреди записи тренировки — флаг композера уходит в решение', async () => {
    document.documentElement.dataset.composer = '1'
    pending.url = 'https://x/kachalka-app/?push=update'
    renderHook(() => useAppNav(ME))
    await waitFor(() => expect(reloadForUpdatePush).toHaveBeenCalled())
    expect(reloadForUpdatePush.mock.calls[0][0].composerOpen).toBe(true)
  })

  it('прочие пуши обновление не трогают', async () => {
    pending.url = 'https://x/kachalka-app/?push=friend'
    const { result } = renderHook(() => useAppNav(ME))
    await waitFor(() => expect(result.current.tab).toBe('friends'))
    expect(reloadForUpdatePush).not.toHaveBeenCalled()
  })
})
