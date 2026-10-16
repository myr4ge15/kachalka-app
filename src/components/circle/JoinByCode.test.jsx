// @vitest-environment jsdom
// «Вступить по коду»: «Ты в круге» не висит после выхода из круга (обращение fb_04d85b8f).
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
