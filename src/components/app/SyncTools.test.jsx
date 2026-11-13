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

  it('офлайн показывает число правок и объясняет, когда они отправятся', () => {
    status.value = { ...base, online: false, pending: 3 }
    render(<SyncTools unread={0} userId="me" />)
    fireEvent.click(screen.getByRole('button', { name: /Офлайн · 3 в очереди/ }))
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Нет сети', sub: expect.stringContaining('Изменений в очереди: 3'),
    }))
    expect(vi.mocked(showToast).mock.lastCall[0].onAction).toBeUndefined()
    expect(syncNow).not.toHaveBeenCalled()
  })

  it('пока очередь отправляется, статус виден, но пояснение еще не требуется', () => {
    status.value = { ...base, syncing: true, pending: 3 }
    render(<SyncTools unread={0} userId="me" />)
    fireEvent.click(screen.getByRole('button', { name: /Синхронизация/ }))
    expect(showToast).not.toHaveBeenCalled()
  })

  it.each([
    [{ pending: 3 }, 'Ждут отправки: 3'],
    [{ dead: 2 }, 'Не отправилось: 2'],
  ])('показывает пояснение без недоступного действия (%j)', (state, title) => {
    status.value = { ...base, ...state }
    render(<SyncTools unread={0} />)
    fireEvent.click(screen.getByRole('button', { name: /Что не так/ }))
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title }))
    expect(vi.mocked(showToast).mock.lastCall[0].onAction).toBeUndefined()
  })

  it.each([[3, '3'], [12, '9+']])('в кнопке уведомлений %i новых отображаются как %s', (unread, label) => {
    status.value = base
    const onOpenNotif = vi.fn()
    render(<SyncTools unread={unread} onOpenNotif={onOpenNotif} />)
    const button = screen.getByRole('button', { name: `Уведомления: ${unread} новых` })
    expect(button).toHaveTextContent(label)
    fireEvent.click(button)
    expect(onOpenNotif).toHaveBeenCalledTimes(1)
  })
})
