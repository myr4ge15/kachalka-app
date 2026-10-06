// @vitest-environment jsdom
// Админка: «Доступ к тренировкам» и перетаскивание порядка учеток (v6.14.1 вынесены
// из AdminScreen, до v6.14.2 без тестов). RPC — заглушки lib/admin.js.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const adminListUsers = vi.fn()
const adminListConnections = vi.fn()
const adminSetConnection = vi.fn()
vi.mock('../../lib/admin.js', () => ({
  adminListUsers: (...a) => adminListUsers(...a),
  adminListConnections: (...a) => adminListConnections(...a),
  adminSetConnection: (...a) => adminSetConnection(...a),
}))
const showToast = vi.fn()
vi.mock('../Toast.jsx', () => ({ showToast: (...a) => showToast(...a) }))

const { default: AccessSection } = await import('./AccessSection.jsx')
const { default: UserReorderList } = await import('./UserReorderList.jsx')

// jsdom без PointerEvent: fireEvent.pointer* иначе теряет clientY/pointerId.
if (!window.PointerEvent) {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId ?? 0 }
  }
}

const errMsg = (e) => 'ERR: ' + (e?.message ?? e)
const users = [
  { id: 'a', name: 'Андрей', is_private: false },
  { id: 'b', name: 'Боря', is_private: true },
  { id: 'c', name: 'Вера', is_private: true },
  { id: 'd', name: 'Гоша', is_private: false },
]
const box = (name) => screen.getByRole('checkbox', { name: new RegExp(name) })

beforeEach(() => {
  vi.clearAllMocks()
  adminListUsers.mockResolvedValue(users)
  adminListConnections.mockResolvedValue([{ low_id: 'a', high_id: 'b', status: 'accepted' }, { low_id: 'b', high_id: 'd', status: 'pending' }])
  adminSetConnection.mockResolvedValue(undefined)
})

describe('AccessSection', () => {
  it('выбирает первого приватного; галочки — только принятые связи; себя помечает «я»', async () => {
    render(<AccessSection meId="a" online errMsg={errMsg} />)
    const sel = await screen.findByRole('combobox')
    expect(sel).toHaveValue('b')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Боря', 'Вера'])
    expect(box('Андрей')).toBeChecked()
    expect(box('Гоша')).not.toBeChecked() // pending не считается
    expect(screen.queryByRole('checkbox', { name: /Боря/ })).not.toBeInTheDocument()
    expect(screen.getByText('я')).toBeInTheDocument()

    fireEvent.change(sel, { target: { value: 'c' } })
    expect(box('Андрей')).not.toBeChecked()
    expect(box('Боря')).toBeInTheDocument()
  })

  it('тап по галочке — оптимистично и одним RPC', async () => {
    render(<AccessSection meId="a" online errMsg={errMsg} />)
    await screen.findByRole('combobox')
    await act(async () => { fireEvent.click(box('Гоша')) })
    expect(adminSetConnection).toHaveBeenCalledWith('b', 'd', true)
    expect(box('Гоша')).toBeChecked()
    await act(async () => { fireEvent.click(box('Андрей')) })
    expect(adminSetConnection).toHaveBeenLastCalledWith('b', 'a', false)
    expect(box('Андрей')).not.toBeChecked()
  })

  it('отказ RPC — тост и откат к серверной правде', async () => {
    adminSetConnection.mockRejectedValueOnce(new Error('403'))
    render(<AccessSection meId="a" online errMsg={errMsg} />)
    await screen.findByRole('combobox')
    await act(async () => { fireEvent.click(box('Гоша')) })
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не удалось', sub: 'ERR: 403' }))
    await waitFor(() => expect(adminListUsers).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(box('Гоша')).not.toBeChecked())
  })

  it('нет приватных — подсказка; ошибка загрузки — плашка; офлайн — без запросов', async () => {
    adminListUsers.mockResolvedValueOnce(users.filter((u) => !u.is_private))
    const { unmount } = render(<AccessSection meId="a" online errMsg={errMsg} />)
    expect(await screen.findByText(/Нет приватных участников/)).toBeInTheDocument()
    unmount()

    adminListConnections.mockRejectedValueOnce(new Error('timeout'))
    const second = render(<AccessSection meId="a" online errMsg={errMsg} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('ERR: timeout')
    second.unmount()

    adminListUsers.mockClear()
    render(<AccessSection meId="a" online={false} errMsg={errMsg} />)
    expect(screen.getByText(/Нет приватных участников/)).toBeInTheDocument()
    expect(adminListUsers).not.toHaveBeenCalled()
  })
})

describe('UserReorderList', () => {
  const list = users.slice(0, 3)
  // jsdom не считает раскладку — задаем строкам высоту 40px по порядку в DOM.
  function layout() {
    screen.getAllByRole('listitem').forEach((li, i) => {
      li.getBoundingClientRect = () => ({ top: i * 40, height: 40, bottom: i * 40 + 40 })
    })
  }
  const handle = (name) => screen.getByRole('button', { name: `Перетащить ${name}` })

  it('порядок не менялся — «Сохранить» неактивна; перетаскивание вниз → новый порядок в onSave', async () => {
    const onSave = vi.fn(async () => {})
    render(<UserReorderList users={list} meId="a" onCancel={vi.fn()} onSave={onSave} errMsg={errMsg} />)
    const save = screen.getByRole('button', { name: 'Сохранить порядок' })
    expect(save).toBeDisabled()

    layout()
    fireEvent.pointerDown(handle('Андрей'), { pointerId: 1, clientY: 10 })
    fireEvent.pointerMove(handle('Андрей'), { pointerId: 1, clientY: 200 }) // ниже всех
    fireEvent.pointerUp(handle('Андрей'), { pointerId: 1 })
    expect(screen.getAllByRole('listitem').map((li) => li.textContent.replace('☰', ''))).toEqual(['Боря', 'Вера', 'Андрейя'])
    expect(save).toBeEnabled()
    await act(async () => { fireEvent.click(save) })
    expect(onSave).toHaveBeenCalledWith(['b', 'c', 'a'])
  })

  it('перетаскивание вверх; движение без захвата игнорируется; «Отмена»', () => {
    const onCancel = vi.fn()
    render(<UserReorderList users={list} meId="a" onCancel={onCancel} onSave={vi.fn()} errMsg={errMsg} />)
    layout()
    fireEvent.pointerMove(handle('Вера'), { clientY: 0 })
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Андрей')

    fireEvent.pointerDown(handle('Вера'), { pointerId: 1, clientY: 100 })
    expect(screen.getAllByRole('listitem')[2]).toHaveClass('dragging')
    fireEvent.pointerMove(handle('Вера'), { pointerId: 1, clientY: 5 })
    fireEvent.pointerCancel(handle('Вера'), { pointerId: 1 })
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Вера')
    expect(screen.getAllByRole('listitem')[0]).not.toHaveClass('dragging')
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('ошибка сохранения — тост, кнопки снова активны', async () => {
    const onSave = vi.fn(async () => { throw new Error('нет сети') })
    render(<UserReorderList users={list} meId="a" onCancel={vi.fn()} onSave={onSave} errMsg={errMsg} />)
    layout()
    fireEvent.pointerDown(handle('Андрей'), { pointerId: 1, clientY: 10 })
    fireEvent.pointerMove(handle('Андрей'), { pointerId: 1, clientY: 60 })
    fireEvent.pointerUp(handle('Андрей'), { pointerId: 1 })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить порядок' })) })
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ sub: 'ERR: нет сети' }))
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeEnabled()
  })
})
