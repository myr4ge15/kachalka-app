// @vitest-environment jsdom
// «Вес и замеры» — то, что не вошло в основной тест экрана: меню записи (правка, удаление в два тапа,
// ошибка удаления), «Показать все / Свернуть», периоды графика и пустой период, цель «держать» в
// сводке, обратный тост глаза. Реальный Dexie (fake-indexeddb); удаление и тост — через шпионов.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { openUserDb, closeUserDb } from '../db/local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import * as bodyDb from '../db/body.js'
import { localYmd } from '../lib/calendar.js'
import { shiftYmd } from '../lib/body.js'
import { showToast } from '../components/ui/Toast.jsx'
import BodyScreen from './BodyScreen.jsx'

vi.mock('../components/ui/Toast.jsx', () => ({ showToast: vi.fn() }))
vi.mock('../db/body.js', async (orig) => {
  const real = await orig()
  return { ...real, deleteBodyEntry: vi.fn(real.deleteBodyEntry) }
})

let userId
const today = localYmd(new Date())
beforeEach(async () => {
  userId = uniqueUserId()
  await openUserDb(userId)
  vi.mocked(showToast).mockReset()
})
afterEach(async () => {
  await closeUserDb()
})

const seed = async (n, step = 3) => {
  for (let i = 0; i < n; i++) await bodyDb.saveBodyEntry(userId, { date: shiftYmd(today, -i * step), weight: 70 + i / 10 })
}
const rows = () => [...document.querySelectorAll('.body-list .body-row')]
const openMenu = (i = 0) => fireEvent.click(screen.getAllByRole('button', { name: /^Запись / })[i])

describe('BodyScreen — записи', () => {
  it('8 записей и «Показать все · N», потом «Свернуть»', async () => {
    await seed(11)
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    const more = await screen.findByRole('button', { name: 'Показать все · 11' })
    expect(rows()).toHaveLength(8)
    fireEvent.click(more)
    expect(rows()).toHaveLength(11)
    expect(screen.getByRole('button', { name: 'Свернуть' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }))
    expect(rows()).toHaveLength(8)
  })

  it('удаление — в два тапа, потом тост; меню закрывается, повторное открытие снова просит подтверждение', async () => {
    await seed(2)
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    await screen.findAllByRole('button', { name: /^Запись / })
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }))
    expect(bodyDb.deleteBodyEntry).not.toHaveBeenCalled()
    // закрыли меню — подтверждение сбросилось
    openMenu()
    openMenu()
    expect(screen.getByRole('menuitem', { name: 'Удалить' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Точно удалить?' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Запись удалена' })))
    await waitFor(() => expect(rows()).toHaveLength(1))
  })

  it('ошибка удаления — тост с причиной', async () => {
    await seed(1)
    vi.mocked(bodyDb.deleteBodyEntry).mockRejectedValueOnce(new Error('база занята'))
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    await screen.findAllByRole('button', { name: /^Запись / })
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Точно удалить?' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не удалось удалить', sub: 'база занята' })))
  })

  it('«Править» открывает лист с этой записью; правка сохраняет ее же', async () => {
    await bodyDb.saveBodyEntry(userId, { date: shiftYmd(today, -1), weight: 71.2, note: 'утро' })
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    await screen.findAllByRole('button', { name: /^Запись / })
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Править' }))
    const dlg = await screen.findByRole('dialog', { name: 'Правка записи' })
    expect(within(dlg).getByLabelText('Вес, кг').value).toBe('71.2')
    expect(within(dlg).getByDisplayValue('утро')).toBeInTheDocument()
    fireEvent.change(within(dlg).getByLabelText('Вес, кг'), { target: { value: '71' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const b = await bodyDb.getBody(userId)
    expect(b.entries).toHaveLength(1)
    expect(b.entries[0]).toMatchObject({ weight: 71, note: 'утро' })
  })
})

describe('BodyScreen — график, цель, глаз', () => {
  it('периоды графика; старые записи вне «Месяц» — «За этот период записей нет»', async () => {
    await bodyDb.saveBodyEntry(userId, { date: shiftYmd(today, -80), weight: 72 })
    await bodyDb.saveBodyEntry(userId, { date: shiftYmd(today, -60), weight: 71 })
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    expect(await screen.findByRole('img', { name: 'График веса за период' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Месяц' }))
    expect(screen.getByRole('button', { name: 'Месяц' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('За этот период записей нет.')).toBeInTheDocument()
    for (const p of ['Год', 'Все']) {
      fireEvent.click(screen.getByRole('button', { name: p }))
      expect(screen.getByRole('img', { name: 'График веса за период' })).toBeInTheDocument()
    }
  })

  it('цель «держать»: в коридоре — «в цели» зеленым, вне — «до коридора цели» обычным текстом', async () => {
    await seed(1)
    await bodyDb.setBodyPrefs(userId, { goal: { kind: 'keep', target: 70 } })
    const { container, unmount } = render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    expect(await screen.findByText('в цели')).toHaveClass('body-good')
    expect(screen.getByText('коридор 70 ±1.5')).toBeInTheDocument()
    unmount()
    await bodyDb.setBodyPrefs(userId, { goal: { kind: 'keep', target: 65 } })
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    expect(await screen.findByText('до коридора цели')).toBeInTheDocument()
    expect(container.querySelector('.body-good')).toBeNull()
  })

  it('цель «сбросить» достигнута — «цель · достигнута» зеленым', async () => {
    await seed(1)
    await bodyDb.setBodyPrefs(userId, { goal: { kind: 'down', target: 72 } })
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    expect(await screen.findByText('достигнута')).toBeInTheDocument()
    expect(document.querySelector('.body-stat-v.body-good').textContent).toBe('цель')
  })

  it('глаз: «скрыть» → тост-пояснение, «показать» → «Цифры снова видны»', async () => {
    await seed(1)
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Скрыть цифры' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Цифры скрыты' })))
    fireEvent.click(await screen.findByRole('button', { name: 'Показать цифры' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Цифры снова видны' })))
    expect(await screen.findByRole('button', { name: 'Скрыть цифры' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('«назад» — onBack', async () => {
    const onBack = vi.fn()
    render(<BodyScreen user={{ id: userId }} onBack={onBack} />)
    await screen.findByText('Записей пока нет')
    fireEvent.click(screen.getByRole('button', { name: /Назад/i }))
    expect(onBack).toHaveBeenCalled()
  })
})
