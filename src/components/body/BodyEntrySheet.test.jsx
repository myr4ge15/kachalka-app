// @vitest-environment jsdom
// Лист записи «Вес и замеры»: проверка веса, «−/+» с пустого поля, тумблеры обхватов, правка записи
// с весом и обхватами, сохранение выключенного обхвата у старой записи, ошибка записи.
// Запись — заглушки db/body.js: здесь проверяем только, что лист соберет и отправит.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import BodyEntrySheet from './BodyEntrySheet.jsx'
import { saveBodyEntry, setBodyPrefs } from '../../db/body.js'
import { showToast } from '../ui/Toast.jsx'
import { normalizeBody } from '../../lib/body.js'
import { localYmd } from '../../lib/calendar.js'

vi.mock('../../db/body.js', () => ({ saveBodyEntry: vi.fn(async () => 'id1'), setBodyPrefs: vi.fn(async () => {}) }))
vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))

const today = localYmd(new Date())
const body = (extra = {}) => normalizeBody({ entries: [], ...extra })
const dlg = () => screen.getByRole('dialog')
const sent = () => vi.mocked(saveBodyEntry).mock.calls.at(-1)[1]

beforeEach(() => {
  vi.mocked(saveBodyEntry).mockReset().mockResolvedValue('id1')
  vi.mocked(setBodyPrefs).mockReset().mockResolvedValue(undefined)
  vi.mocked(showToast).mockReset()
})

describe('BodyEntrySheet — вес', () => {
  it('вес вне 20..350 — подсказка и «Сохранить» неактивна; запятая понимается', async () => {
    const onClose = vi.fn()
    render(<BodyEntrySheet userId="u1" body={body()} onClose={onClose} />)
    const w = within(dlg()).getByLabelText('Вес, кг')
    fireEvent.change(w, { target: { value: '5' } })
    expect(within(dlg()).getByText('Вес — от 20 до 350 кг.')).toBeInTheDocument()
    expect(w).toHaveAttribute('aria-invalid', 'true')
    expect(within(dlg()).getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    fireEvent.change(w, { target: { value: '81,5' } })
    fireEvent.change(within(dlg()).getByPlaceholderText('необязательно'), { target: { value: 'утро' } })
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(sent()).toMatchObject({ date: today, weight: 81.5, note: 'утро' })
  })

  it('«−» с пустого поля — от прошлого веса; «Прошлый раз — …»', () => {
    render(<BodyEntrySheet userId="u1" body={body()} last={{ date: today, weight: 80 }} onClose={() => {}} />)
    const w = within(dlg()).getByLabelText('Вес, кг')
    expect(w.value).toBe('80')
    expect(within(dlg()).getByText(/Прошлый раз — 80 кг/)).toBeInTheDocument()
    fireEvent.change(w, { target: { value: '' } })
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Вес меньше на 0.1' }))
    expect(w.value).toBe('80')
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Вес меньше на 0.1' }))
    expect(w.value).toBe('79.9')
  })

  it('ошибка записи — тост, лист остается открытым и снова доступен', async () => {
    vi.mocked(saveBodyEntry).mockRejectedValueOnce(new Error('диск полон'))
    const onClose = vi.fn()
    render(<BodyEntrySheet userId="u1" body={body()} onClose={onClose} />)
    fireEvent.change(within(dlg()).getByLabelText('Вес, кг'), { target: { value: '80' } })
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не удалось записать', sub: 'диск полон' })))
    expect(onClose).not.toHaveBeenCalled()
    expect(within(dlg()).getByRole('button', { name: 'Сохранить' })).not.toBeDisabled()
  })

  it('пустой ответ записи («нечего записать») — тоже тост, а не тихое закрытие', async () => {
    vi.mocked(saveBodyEntry).mockResolvedValueOnce(null)
    const onClose = vi.fn()
    render(<BodyEntrySheet userId="u1" body={body()} onClose={onClose} />)
    fireEvent.change(within(dlg()).getByLabelText('Вес, кг'), { target: { value: '80' } })
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ sub: 'нечего записать' })))
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('BodyEntrySheet — замеры и правка', () => {
  it('тумблер обхвата выключает ведение; включенный уходит в запись', async () => {
    render(<BodyEntrySheet userId="u1" body={body({ fields: ['waist', 'chest'] })} mode="measures" onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Замеры' })).toBeInTheDocument()
    fireEvent.click(within(dlg()).getByRole('switch', { name: 'Вести: Грудь' }))
    await waitFor(() => expect(setBodyPrefs).toHaveBeenCalledWith('u1', { fields: ['waist'] }))
    fireEvent.change(within(dlg()).getByLabelText('Талия, см'), { target: { value: '84' } })
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(saveBodyEntry).toHaveBeenCalled())
    expect(sent()).toMatchObject({ waist: '84', chest: '' })
    expect(sent().weight).toBeUndefined()
  })

  it('правка записи с весом и обхватами — видны оба раздела; выключенный обхват не стирается', async () => {
    const entry = { id: 'e1', date: '2026-10-20', weight: 82, waist: 84, thigh: 58, note: 'зал' }
    render(<BodyEntrySheet userId="u1" body={body({ fields: ['waist'] })} entry={entry} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Правка записи' })).toBeInTheDocument()
    expect(within(dlg()).getByLabelText('Вес, кг').value).toBe('82')
    expect(within(dlg()).getByLabelText('Талия, см').value).toBe('84')
    expect(within(dlg()).getByLabelText('Бедро, см')).toBeDisabled()
    expect(within(dlg()).queryByText(/Прошлый раз/)).toBeNull()
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(saveBodyEntry).toHaveBeenCalled())
    expect(sent()).toMatchObject({ id: 'e1', date: '2026-10-20', weight: 82, waist: '84', thigh: 58, note: 'зал' })
  })

  it('правка записи только с обхватами — веса в листе нет, но и не теряется', async () => {
    const entry = { id: 'e2', date: '2026-10-20', waist: 84 }
    render(<BodyEntrySheet userId="u1" body={body({ fields: ['waist'] })} entry={entry} onClose={() => {}} />)
    expect(within(dlg()).queryByLabelText('Вес, кг')).toBeNull()
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(sent()).toMatchObject({ id: 'e2', waist: '84' }))
  })

  it('скрытые цифры при правке — значения записи видны (человек сам открыл запись)', () => {
    const entry = { id: 'e3', date: '2026-10-20', weight: 82 }
    render(<BodyEntrySheet userId="u1" body={body({ hide: true })} entry={entry} onClose={() => {}} />)
    expect(within(dlg()).getByLabelText('Вес, кг').value).toBe('82')
  })
})
