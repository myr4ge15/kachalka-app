// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const status = vi.hoisted(() => ({ value: {} }))
vi.mock('../../db/sync.js', () => ({ useSyncStatus: () => status.value, syncNow: vi.fn() }))
vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))

import SyncTools from './SyncTools.jsx'
import { syncNow } from '../../db/sync.js'
import { showToast } from '../ui/Toast.jsx'

const base = { online: true, syncing: false, pending: 0, dead: 0, netError: false, lastError: null }

describe('SyncTools — бейдж синка объясняет себя (fb_dbdf463c)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('в норме бейджа нет', () => {
    status.value = base
    render(<SyncTools unread={0} onOpenNotif={() => {}} userId="me" />)
    expect(screen.queryByRole('button', { name: /Что не так/ })).toBeNull()
  })

  it('сбой связи: тап — причина и «Повторить» запускает синк', () => {
    status.value = { ...base, netError: true, lastError: 'Сессия завершена на сервере — войди заново' }
    render(<SyncTools unread={0} onOpenNotif={() => {}} userId="me" />)
    fireEvent.click(screen.getByRole('button', { name: /Что не так/ }))
    const toast = vi.mocked(showToast).mock.calls[0][0]
    expect(toast).toMatchObject({ sub: 'Сессия завершена на сервере — войди заново', actionLabel: 'Повторить' })
    toast.onAction()
    expect(syncNow).toHaveBeenCalledWith('me')
  })

  it('застрявшие правки — «Открыть» ведет в Профиль', () => {
    status.value = { ...base, dead: 2 }
    const onOpenProfile = vi.fn()
    render(<SyncTools unread={0} onOpenNotif={() => {}} userId="me" onOpenProfile={onOpenProfile} />)
    fireEvent.click(screen.getByRole('button', { name: /Что не так/ }))
    const toast = vi.mocked(showToast).mock.calls[0][0]
    expect(toast.actionLabel).toBe('Открыть')
    toast.onAction()
    expect(onOpenProfile).toHaveBeenCalled()
  })
})
