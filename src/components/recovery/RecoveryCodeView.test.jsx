// @vitest-environment jsdom
// Код восстановления (П1): показ один раз, «Скопировать» — в буфер с отметкой; без доступа к
// буферу — тихо (перепишут руками); «Я сохранил код» / своя подпись.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import RecoveryCodeView from './RecoveryCodeView.jsx'

afterEach(() => vi.unstubAllGlobals())

describe('RecoveryCodeView', () => {
  it('код на экране; «Скопировать» кладет в буфер и меняет подпись', async () => {
    const writeText = vi.fn().mockResolvedValue()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const onDone = vi.fn()
    render(<RecoveryCodeView code="ABCD-EFGH-JKMN-PQRS" onDone={onDone} />)
    expect(screen.getByTestId('recovery-code')).toHaveTextContent('ABCD-EFGH-JKMN-PQRS')
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Скопировано' })).toBeInTheDocument())
    expect(writeText).toHaveBeenCalledWith('ABCD-EFGH-JKMN-PQRS')
    fireEvent.click(screen.getByRole('button', { name: 'Я сохранил код' }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('буфер недоступен — подпись прежняя, без ошибки; своя подпись кнопки', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<RecoveryCodeView code="X" onDone={() => {}} doneLabel="Готово" />)
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Скопировать' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Готово' })).toBeInTheDocument()
  })
})
