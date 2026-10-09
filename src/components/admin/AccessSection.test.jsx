// @vitest-environment jsdom
// Админка: «Доступ к тренировкам» и перетаскивание порядка учеток (v6.14.1 вынесены
// из AdminScreen, до v6.14.2 без тестов). RPC — заглушки lib/admin.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  // jsdom не считает раскладку — строки по 40px с зазором 8px, по порядку в DOM.
  function layout() {
    screen.getAllByRole('listitem').forEach((li) => {
      li.getBoundingClientRect = () => {
        const i = [...li.parentNode.children].indexOf(li)
        return { top: i * 48, height: 40, bottom: i * 48 + 40 }
      }
    })
  }
  // «Уменьшить движение» — строка встает на место без анимации, порядок применяется сразу.
  beforeEach(() => { window.matchMedia = vi.fn(() => ({ matches: true })) })
  afterEach(() => { delete window.matchMedia })
  const handle = (name) => screen.getByRole('button', { name: `Перетащить ${name}` })
  const names = () => screen.getAllByRole('listitem').map((li) => li.textContent.replace('☰', ''))
  const drag = (name, from, to) => {
    fireEvent.touchStart(handle(name), { touches: [{ clientX: 5, clientY: from }] })
    fireEvent.touchMove(handle(name), { touches: [{ clientX: 5, clientY: to }] })
    fireEvent.touchEnd(handle(name))
  }

  it('порядок не менялся — «Сохранить» неактивна; перетаскивание вниз → новый порядок в onSave', async () => {
    const onSave = vi.fn(async () => {})
    render(<UserReorderList users={list} meId="a" onCancel={vi.fn()} onSave={onSave} errMsg={errMsg} />)
    const save = screen.getByRole('button', { name: 'Сохранить порядок' })
    expect(save).toBeDisabled()

    layout()
    fireEvent.touchStart(handle('Андрей'), { touches: [{ clientX: 5, clientY: 20 }] })
    expect(screen.getAllByRole('listitem')[0]).toHaveClass('sort-lifted') // за ручку — сразу
    fireEvent.touchMove(handle('Андрей'), { touches: [{ clientX: 5, clientY: 200 }] }) // ниже всех
    expect(names()).toEqual(['Андрейя', 'Боря', 'Вера']) // пока едет — порядок прежний
    fireEvent.touchEnd(handle('Андрей'))
    expect(names()).toEqual(['Боря', 'Вера', 'Андрейя'])
    expect(save).toBeEnabled()
    await act(async () => { fireEvent.click(save) })
    expect(onSave).toHaveBeenCalledWith(['b', 'c', 'a'])
  })

  it('перетаскивание вверх; отмена касания возвращает строку; Alt+↑; «Отмена»', () => {
    const onCancel = vi.fn()
    render(<UserReorderList users={list} meId="a" onCancel={onCancel} onSave={vi.fn()} errMsg={errMsg} />)
    layout()
    fireEvent.touchStart(handle('Вера'), { touches: [{ clientX: 5, clientY: 116 }] })
    fireEvent.touchMove(handle('Вера'), { touches: [{ clientX: 5, clientY: 0 }] })
    fireEvent.touchCancel(handle('Вера'))
    expect(names()[0]).toBe('Андрейя')
    expect(screen.getAllByRole('listitem')[2]).not.toHaveClass('sort-lifted')

    drag('Вера', 116, 0)
    expect(names()).toEqual(['Вера', 'Андрейя', 'Боря'])
    fireEvent.keyDown(handle('Боря'), { altKey: true, key: 'ArrowUp' })
    expect(names()).toEqual(['Вера', 'Боря', 'Андрейя'])
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('ошибка сохранения — тост, кнопки снова активны', async () => {
    const onSave = vi.fn(async () => { throw new Error('нет сети') })
    render(<UserReorderList users={list} meId="a" onCancel={vi.fn()} onSave={onSave} errMsg={errMsg} />)
    layout()
    drag('Андрей', 20, 70)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить порядок' })) })
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ sub: 'ERR: нет сети' }))
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeEnabled()
  })
})
