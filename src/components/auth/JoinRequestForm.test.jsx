// @vitest-environment jsdom
// Форма «Запросить доступ» (покрытие тестами 20.10.2026: ветки 50 %): проверка до сети,
// ошибки сервера человеческим текстом, ловушка для ботов уходит на сервер, повторная
// отправка не уходит, пока идет первая.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import JoinRequestForm from './JoinRequestForm.jsx'
import { submitJoin, JoinError } from '../../lib/joinRequest.js'

vi.mock('../../lib/joinRequest.js', async (orig) => ({ ...(await orig()), submitJoin: vi.fn() }))
afterEach(() => vi.clearAllMocks())

const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }))

describe('JoinRequestForm', () => {
  it('без имени — подсказка, без запроса', () => {
    render(<JoinRequestForm />)
    send()
    expect(screen.getByRole('alert')).toHaveTextContent('Напиши, как тебя зовут.')
    expect(submitJoin).not.toHaveBeenCalled()
  })

  it('заявка ушла — наверх отдается ожидание; поле-ловушка уходит как есть', async () => {
    vi.mocked(submitJoin).mockResolvedValue({ id: 'j1' })
    const onSubmitted = vi.fn()
    const { container } = render(<JoinRequestForm onSubmitted={onSubmitted} />)
    fill('Как тебя зовут', 'Петя')
    fill(/Ник в Telegram/, '@petya_k')
    fill('Пара слов о себе', 'друг Димы')
    fireEvent.change(container.querySelector('.hp input'), { target: { value: 'spam.example' } })
    send()
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith({ id: 'j1' }))
    expect(submitJoin).toHaveBeenCalledWith({ name: 'Петя', about: 'друг Димы', tg: '@petya_k', website: 'spam.example' })
  })

  it('кривой ник в Telegram — подсказка до сети (fb_6af9ae21)', () => {
    render(<JoinRequestForm />)
    fill('Как тебя зовут', 'Петя')
    fill(/Ник в Telegram/, 'пётр')
    send()
    expect(screen.getByRole('alert')).toHaveTextContent('Ник в Telegram')
    expect(submitJoin).not.toHaveBeenCalled()
  })

  it('ошибки сервера — понятный текст, форму можно отправить снова', async () => {
    vi.mocked(submitJoin).mockRejectedValueOnce(new JoinError('rate_limited')).mockRejectedValueOnce(new Error('boom'))
    render(<JoinRequestForm />)
    fill('Как тебя зовут', 'Петя')
    send()
    expect(await screen.findByRole('alert')).toHaveTextContent('Попробуй завтра')
    send()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не получилось отправить'))
    fill('Как тебя зовут', 'Петя!') // ввод снимает ошибку
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('пока идет отправка — повторно не уходит, «Назад» заблокирована', async () => {
    let finish
    vi.mocked(submitJoin).mockImplementation(() => new Promise((r) => { finish = r }))
    const onBack = vi.fn()
    render(<JoinRequestForm onBack={onBack} onSubmitted={vi.fn()} />)
    fill('Как тебя зовут', 'Петя')
    send()
    fireEvent.submit(screen.getByRole('button', { name: /Отправляю/ }).closest('form'))
    expect(submitJoin).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Назад' })).toBeDisabled()
    finish({ id: 'j1' })
  })
})
