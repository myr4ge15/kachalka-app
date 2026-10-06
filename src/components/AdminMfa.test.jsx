// @vitest-environment jsdom
// AdminMfa (v6.14.0) — интерфейс 2FA Админки: шлюз с кодом и панель включения/
// отключения. Логика supabase.auth.mfa покрыта lib/adminMfa.test.js; здесь —
// состояния формы, блокировки офлайн и показ ошибок (до v6.14.2 без тестов).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const verifyCode = vi.fn()
const startEnroll = vi.fn()
const disableMfa = vi.fn()
vi.mock('../lib/adminMfa.js', async (orig) => ({
  ...(await orig()),
  verifyCode: (...a) => verifyCode(...a),
  startEnroll: (...a) => startEnroll(...a),
  disableMfa: (...a) => disableMfa(...a),
}))
const { AdminMfaGate, AdminMfaPanel } = await import('./AdminMfa.jsx')
const { MfaError } = await import('../lib/adminMfa.js')

const codeInput = () => screen.getByLabelText('Код из приложения')

beforeEach(() => { verifyCode.mockReset(); startEnroll.mockReset(); disableMfa.mockReset() })

describe('AdminMfaGate', () => {
  it('принимает только цифры; кнопка активна на 6 цифрах; успех → onPassed', async () => {
    verifyCode.mockResolvedValue(undefined)
    const onPassed = vi.fn()
    render(<AdminMfaGate factorId="f1" online onPassed={onPassed} />)
    const btn = screen.getByRole('button', { name: 'Войти в Админку' })
    fireEvent.change(codeInput(), { target: { value: '12 3-4a' } })
    expect(codeInput()).toHaveValue('1234')
    expect(btn).toBeDisabled()
    fireEvent.change(codeInput(), { target: { value: '123456' } })
    expect(btn).toBeEnabled()
    await act(async () => { fireEvent.click(btn) })
    expect(verifyCode).toHaveBeenCalledWith('f1', '123456')
    expect(onPassed).toHaveBeenCalledOnce()
  })

  it('неверный код — понятная ошибка, поле очищено; ввод стирает ошибку', async () => {
    verifyCode.mockRejectedValue(new MfaError('bad_code', 'Неверный код'))
    const onPassed = vi.fn()
    render(<AdminMfaGate factorId="f1" online onPassed={onPassed} />)
    fireEvent.change(codeInput(), { target: { value: '000000' } })
    fireEvent.submit(codeInput().closest('form'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Неверный код')
    expect(codeInput()).toHaveValue('')
    expect(onPassed).not.toHaveBeenCalled()
    fireEvent.change(codeInput(), { target: { value: '1' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('офлайн — поле и кнопка заблокированы, подсказка про сеть; submit не уходит', () => {
    render(<AdminMfaGate factorId="f1" online={false} onPassed={vi.fn()} />)
    expect(codeInput()).toBeDisabled()
    expect(screen.getByText(/Нет сети/)).toBeInTheDocument()
    fireEvent.submit(codeInput().closest('form'))
    expect(verifyCode).not.toHaveBeenCalled()
  })
})

describe('AdminMfaPanel', () => {
  it('выключена → «Включить 2FA» → QR и ключ группами → код → onChange', async () => {
    startEnroll.mockResolvedValue({ factorId: 'f9', qr: 'data:image/svg+xml;base64,AA', secret: 'ABCDEFGHIJKL' })
    verifyCode.mockResolvedValue(undefined)
    const onChange = vi.fn(async () => {})
    const state = { enabled: false }
    render(<AdminMfaPanel state={state} online onChange={onChange} />)
    expect(screen.getByText('2FA выключена')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Включить 2FA' })) })
    expect(startEnroll).toHaveBeenCalledWith(state)
    expect(screen.getByAltText(/QR-код/)).toHaveAttribute('src', 'data:image/svg+xml;base64,AA')
    expect(screen.getByLabelText('Ключ для ручного ввода')).toHaveTextContent('ABCD EFGH IJKL')

    const ok = screen.getByRole('button', { name: 'Включить' })
    expect(ok).toBeDisabled()
    fireEvent.change(codeInput(), { target: { value: '654321' } })
    await act(async () => { fireEvent.click(ok) })
    expect(verifyCode).toHaveBeenCalledWith('f9', '654321')
    expect(onChange).toHaveBeenCalledOnce()
    expect(screen.getByText('2FA выключена')).toBeInTheDocument() // enroll сброшен; новое state придет от родителя
  })

  it('ошибка подготовки — текст ошибки; «Отмена» в шаге QR возвращает к началу', async () => {
    startEnroll.mockRejectedValueOnce(new Error('сеть'))
    render(<AdminMfaPanel state={{ enabled: false }} online onChange={vi.fn()} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Включить 2FA' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('сеть')

    startEnroll.mockResolvedValueOnce({ factorId: 'f', qr: null, secret: 'AAAA' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Включить 2FA' })) })
    expect(screen.queryByAltText(/QR-код/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.getByRole('button', { name: 'Включить 2FA' })).toBeInTheDocument()
  })

  it('неверный код при включении — ошибка, шаг QR остается', async () => {
    startEnroll.mockResolvedValue({ factorId: 'f', qr: null, secret: 'AAAA' })
    verifyCode.mockRejectedValue(new MfaError('bad_code', 'Код не подошел'))
    const onChange = vi.fn()
    render(<AdminMfaPanel state={{ enabled: false }} online onChange={onChange} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Включить 2FA' })) })
    fireEvent.change(codeInput(), { target: { value: '111111' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Включить' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('Код не подошел')
    expect(screen.getByText('Шаг 2 — введи код')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('включена: отключение в два тапа → disableMfa(factorId) → onChange', async () => {
    disableMfa.mockResolvedValue(undefined)
    const onChange = vi.fn(async () => {})
    render(<AdminMfaPanel state={{ enabled: true, factorId: 'f1' }} online onChange={onChange} />)
    expect(screen.getByText('✅ 2FA включена')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Отключить 2FA' }))
    expect(disableMfa).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Точно отключить?' })) })
    expect(disableMfa).toHaveBeenCalledWith('f1')
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce())
  })

  it('офлайн — включение и отключение недоступны', () => {
    const { rerender } = render(<AdminMfaPanel state={{ enabled: false }} online={false} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Включить 2FA' })).toBeDisabled()
    rerender(<AdminMfaPanel state={{ enabled: true, factorId: 'f' }} online={false} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Отключить 2FA' })).toBeDisabled()
  })
})
