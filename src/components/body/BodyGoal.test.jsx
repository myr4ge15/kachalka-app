// @vitest-environment jsdom
// Цель по весу (BodyGoal): редактор (виды цели, проверка направления, «держать» без выбора числа,
// степперы, отмена, ошибка сохранения) и показ поставленной цели — до цели / прогноз / достигнута,
// со скрытыми цифрами и без. Запись — заглушка setBodyPrefs: здесь проверяем только экран.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import BodyGoal from './BodyGoal.jsx'
import { setBodyPrefs } from '../../db/body.js'
import { showToast } from '../ui/Toast.jsx'

vi.mock('../../db/body.js', () => ({ setBodyPrefs: vi.fn(async () => {}) }))
vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))

const savedGoal = () => setBodyPrefs.mock.calls.at(-1)[1].goal
const field = () => screen.getByLabelText(/Целевой вес|Вес, кг/)

beforeEach(() => {
  vi.mocked(setBodyPrefs).mockReset().mockResolvedValue(undefined)
  vi.mocked(showToast).mockReset()
})

describe('BodyGoal — без цели и редактор', () => {
  it('без цели — спокойная кнопка; открытие подставляет текущий вес, «сбросить» по умолчанию', () => {
    render(<BodyGoal userId="u1" goal={null} current={82.4} pace={null} />)
    expect(screen.getByText('Цель · по желанию')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Поставить цель' }))
    expect(screen.getByRole('radio', { name: 'Сбросить' })).toHaveAttribute('aria-checked', 'true')
    expect(field().value).toBe('82')
  })

  it('«сбросить» выше текущего — подсказка и «Сохранить» неактивна; ниже — сохраняется', async () => {
    render(<BodyGoal userId="u1" goal={null} current={82.4} pace={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Поставить цель' }))
    fireEvent.change(field(), { target: { value: '85' } })
    expect(screen.getByText(/Чтобы сбросить, цель должна быть меньше текущего веса \(82.4 кг\)/)).toBeInTheDocument()
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    fireEvent.change(field(), { target: { value: '78' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(setBodyPrefs).toHaveBeenCalled())
    expect(savedGoal()).toMatchObject({ kind: 'down', target: 78, from: 82.4 })
    expect(savedGoal().set).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await waitFor(() => expect(screen.queryByRole('radiogroup')).toBeNull()) // редактор закрылся
  })

  it('«набрать» меньше текущего — подсказка без цифр, если цифры скрыты', () => {
    render(<BodyGoal userId="u1" goal={null} current={82.4} pace={null} hide />)
    fireEvent.click(screen.getByRole('button', { name: 'Поставить цель' }))
    expect(field().value).toBe('') // скрытые цифры: текущий вес не подставляем
    fireEvent.click(screen.getByRole('radio', { name: 'Набрать' }))
    fireEvent.change(field(), { target: { value: '70' } })
    expect(screen.getByText('Чтобы набрать, цель должна быть больше текущего веса.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/82/)
  })

  it('степперы ±0.5 в границах; по пустому полю неактивны', () => {
    render(<BodyGoal userId="u1" goal={null} current={null} pace={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Поставить цель' }))
    expect(field().value).toBe('')
    expect(screen.getByRole('button', { name: 'Цель больше на 0.5' })).toBeDisabled()
    fireEvent.change(field(), { target: { value: '349.8' } })
    fireEvent.click(screen.getByRole('button', { name: 'Цель больше на 0.5' }))
    expect(field().value).toBe('350')
    fireEvent.click(screen.getByRole('button', { name: 'Цель меньше на 0.5' }))
    expect(field().value).toBe('349.5')
  })

  it('«держать» с известным весом — без выбора числа, держим текущий с шагом 0.5', async () => {
    render(<BodyGoal userId="u1" goal={null} current={70.3} pace={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Поставить цель' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Держать' }))
    expect(screen.queryByLabelText(/Целевой вес|Вес, кг/)).toBeNull()
    expect(screen.getByText(/Держим около 70.5 кг — коридор ±1.5 кг/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(savedGoal()).toMatchObject({ kind: 'keep', target: 70.5 }))
  })

  it('«держать» без записей — вес вводится сам; со скрытыми цифрами — «держим текущий вес»', () => {
    const { unmount } = render(<BodyGoal userId="u1" goal={null} current={null} pace={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Поставить цель' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Держать' }))
    expect(screen.getByLabelText('Вес, кг (коридор ±1.5)')).toBeInTheDocument()
    unmount()
    render(<BodyGoal userId="u1" goal={null} current={70} pace={null} hide />)
    fireEvent.click(screen.getByRole('button', { name: 'Поставить цель' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Держать' }))
    expect(screen.getByText(/Держим текущий вес — коридор/)).toBeInTheDocument()
  })

  it('«Отмена» закрывает без записи; ошибка записи — тост, редактор остается', async () => {
    render(<BodyGoal userId="u1" goal={null} current={82} pace={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Поставить цель' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.getByRole('button', { name: 'Поставить цель' })).toBeInTheDocument()
    expect(setBodyPrefs).not.toHaveBeenCalled()

    vi.mocked(setBodyPrefs).mockRejectedValueOnce(new Error('диск полон'))
    fireEvent.click(screen.getByRole('button', { name: 'Поставить цель' }))
    fireEvent.change(field(), { target: { value: '78' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не удалось сохранить цель', sub: 'диск полон' })))
    expect(screen.getByRole('radiogroup', { name: 'Какая цель' })).toBeInTheDocument()
  })
})

describe('BodyGoal — поставленная цель', () => {
  it('«сбросить»: сколько до цели и прогноз, когда тренд идет к ней', () => {
    render(<BodyGoal userId="u1" goal={{ kind: 'down', target: 78 }} current={82} pace={-0.5} />)
    expect(screen.getByText('Сбросить до 78 кг')).toBeInTheDocument()
    expect(screen.getByText(/^4 кг до цели · ≈ к \d+ \S+/)).toBeInTheDocument()
  })

  it('тренд идет не туда — прогноза нет и упрека тоже', () => {
    render(<BodyGoal userId="u1" goal={{ kind: 'up', target: 90 }} current={82} pace={-0.3} />)
    expect(screen.getByText('Набрать до 90 кг')).toBeInTheDocument()
    expect(screen.getByText('8 кг до цели')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/≈|не туда|отста/)
  })

  it('достигнута — зеленым; «держать» в коридоре — «держишь», вне — без подписи', () => {
    const { rerender, container } = render(<BodyGoal userId="u1" goal={{ kind: 'down', target: 78 }} current={77.8} pace={null} />)
    expect(screen.getByText('цель достигнута')).toHaveClass('body-good')
    rerender(<BodyGoal userId="u1" goal={{ kind: 'keep', target: 70 }} current={71} pace={null} />)
    expect(screen.getByText('Держать 70 кг')).toBeInTheDocument()
    expect(screen.getByText('держишь')).toHaveClass('body-good')
    rerender(<BodyGoal userId="u1" goal={{ kind: 'keep', target: 70 }} current={75} pace={null} />)
    expect(container.querySelector('.body-goal-sub')).toBeNull()
  })

  it('скрытые цифры: в заголовке нет веса; «идешь к цели», «держишь», «цель достигнута» — без чисел', () => {
    const { rerender } = render(<BodyGoal userId="u1" goal={{ kind: 'down', target: 78 }} current={82} pace={-0.5} hide />)
    expect(screen.getByText('Сбросить до')).toBeInTheDocument()
    expect(screen.getByText(/^идешь к цели · ≈ к /)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/78|82|кг/)
    rerender(<BodyGoal userId="u1" goal={{ kind: 'keep', target: 70 }} current={70.5} pace={null} hide />)
    expect(screen.getByText('держишь')).toBeInTheDocument()
    rerender(<BodyGoal userId="u1" goal={{ kind: 'up', target: 70 }} current={71} pace={null} hide />)
    expect(screen.getByText('цель достигнута')).toBeInTheDocument()
    rerender(<BodyGoal userId="u1" goal={{ kind: 'up', target: 90 }} current={71} pace={-0.2} hide />)
    expect(document.querySelector('.body-goal-sub')).toBeNull()
  })

  it('«Снять цель» пишет null; «Изменить» открывает редактор с видом и числом цели', async () => {
    render(<BodyGoal userId="u1" goal={{ kind: 'up', target: 90 }} current={82} pace={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }))
    expect(screen.getByRole('radio', { name: 'Набрать' })).toHaveAttribute('aria-checked', 'true')
    expect(field().value).toBe('90')
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    fireEvent.click(screen.getByRole('button', { name: 'Снять цель' }))
    await waitFor(() => expect(setBodyPrefs).toHaveBeenCalledWith('u1', { goal: null }))
  })
})
