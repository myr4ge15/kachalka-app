// @vitest-environment jsdom
// «Вступить по коду»: «Ты в круге» не висит после выхода из круга (обращение fb_04d85b8f).
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import JoinByCode from './JoinByCode.jsx'

const api = {
  preview: vi.fn(async () => ({ status: 'ok', circle_name: 'Зал', inviter_name: 'Сега' })),
  join: vi.fn(async () => ({ status: 'active', circle_id: 'c1' })),
}

async function joinCircle(rerender, memberOf) {
  fireEvent.change(screen.getByLabelText('Вступить по коду'), { target: { value: 'ABCD-EFGH' } })
  fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Вступить' }))
  expect(await screen.findByText('Ты в круге 🎉')).toBeInTheDocument()
  rerender(<JoinByCode api={api} memberOf={memberOf} />)
}

describe('JoinByCode', () => {
  it('показывает отказ проверки и позволяет отправить код с клавиатуры', async () => {
    const preview = vi.fn().mockResolvedValueOnce({ status: 'invalid' }).mockRejectedValueOnce(new Error('Нет связи'))
    const { unmount } = render(<JoinByCode api={{ preview }} initialCode="ABCDEFGH" compact />)
    const field = screen.getByLabelText('Вступить по коду')
    expect(await screen.findByRole('status')).toBeInTheDocument()
    fireEvent.keyDown(field, { key: 'Tab' })
    expect(preview).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByText('Нет связи')).toBeInTheDocument()
    const request = Promise.withResolvers()
    preview.mockReturnValueOnce(request.promise)
    fireEvent.keyDown(field, { key: 'Enter' })
    unmount()
    await act(() => request.resolve({ status: 'ok' }))
  })

  it.each(['pending', 'invalid'])('результат вступления %s управляет очисткой кода и уведомлением', async (status) => {
    const onJoined = vi.fn()
    const join = vi.fn(async () => ({ status }))
    render(<JoinByCode api={{ preview: api.preview, join }} initialCode="ABCDEFGH" onJoined={onJoined} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Вступить' }))
    await screen.findByRole('status')
    if (status === 'pending') {
      expect(onJoined).toHaveBeenCalledExactlyOnceWith({ status })
      expect(screen.getByLabelText('Вступить по коду')).toHaveValue('')
    } else {
      expect(onJoined).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Вступить по коду')).toHaveValue('ABCD-EFGH')
    }
  })
  it('«Ты в круге» остается, пока человек в круге', async () => {
    const { rerender } = render(<JoinByCode api={api} memberOf={[]} />)
    await joinCircle(rerender, ['c1'])
    expect(screen.getByText('Ты в круге 🎉')).toBeInTheDocument()
  })

  it('список еще не обновился после вступления — надпись не гаснет', async () => {
    const { rerender } = render(<JoinByCode api={api} memberOf={[]} />)
    await joinCircle(rerender, [])
    expect(screen.getByText('Ты в круге 🎉')).toBeInTheDocument()
  })

  it('вышел из круга — «Ты в круге» пропадает', async () => {
    const { rerender } = render(<JoinByCode api={api} memberOf={[]} />)
    await joinCircle(rerender, ['c1'])
    rerender(<JoinByCode api={api} memberOf={[]} />)
    expect(screen.queryByText('Ты в круге 🎉')).not.toBeInTheDocument()
  })
})
