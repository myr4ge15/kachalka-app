// @vitest-environment jsdom
// «Вес и замеры» на реальном Dexie (fake-indexeddb) и настоящем useLiveQuery: правила
// «Как не угнетать» проверяем по DOM — скрытые цифры в него не попадают, без цели нет
// ни одного зеленого числа, в списке записей — только вес, без разниц день ко дню.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { openUserDb, closeUserDb } from '../db/local.js'
import { uniqueUserId } from '../test/idbHarness.js'
import { getBody, saveBodyEntry, setBodyPrefs } from '../db/body.js'
import { localYmd } from '../lib/calendar.js'
import { shiftYmd } from '../lib/body.js'
import BodyScreen from './BodyScreen.jsx'

let userId
const today = localYmd(new Date())
beforeEach(async () => {
  userId = uniqueUserId()
  await openUserDb(userId)
})
afterEach(async () => {
  await closeUserDb()
})

async function seed() {
  for (let i = 40; i >= 0; i -= 2) {
    await saveBodyEntry(userId, { date: shiftYmd(today, -i), weight: Math.round((84 - (40 - i) * 0.05) * 10) / 10 })
  }
}

describe('BodyScreen', () => {
  it('без записей — спокойный экран без призывов и графика', async () => {
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    expect(await screen.findByText('Записей пока нет')).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
    expect(document.body.textContent).not.toMatch(/давно|отста|норм|ИМТ/i)
  })

  it('сверху — последнее взвешивание; без цели — ни одного «хорошего/плохого» цвета', async () => {
    await seed()
    const { container } = render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    expect(await screen.findByText(/Последняя запись/)).toBeInTheDocument()
    expect(container.querySelector('.body-now-v').textContent).toBe('82 кг')
    expect(screen.getByText(/за 30 дн\./)).toBeInTheDocument()
    expect(container.querySelector('.body-good')).toBeNull()
    expect(screen.getByRole('img', { name: 'График веса за период' })).toBeInTheDocument()
    // в списке — только вес, без «+0.1 / −0.1» к прошлой записи
    const list = container.querySelector('.body-list')
    expect(list.textContent).not.toMatch(/[+−]\d/)
  })

  it('с целью «сбросить» движение вниз — зеленым, и только оно', async () => {
    await seed()
    await setBodyPrefs(userId, { goal: { kind: 'down', target: 78 } })
    const { container } = render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    await screen.findByText(/до цели 78/)
    const good = [...container.querySelectorAll('.body-good')].map((n) => n.textContent)
    expect(good.length).toBeGreaterThan(0)
    expect(good.every((t) => t.startsWith('−'))).toBe(true)
  })

  it('«Скрыть цифры»: ни веса, ни оси графика в DOM; переключатель синкается', async () => {
    await seed()
    await saveBodyEntry(userId, { date: today, weight: 81.7, waist: 84 })
    await setBodyPrefs(userId, { fields: ['waist'] })
    const { container } = render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Скрыть цифры' }))
    await screen.findByRole('img', { name: /без цифр/ })
    expect((await getBody(userId)).hide).toBe(true)
    const text = container.textContent
    expect(text).not.toMatch(/81\.7|\d+ кг|84 см|талия 84/)
    expect(container.querySelector('.body-chart text.bc-axis + text')).toBeTruthy() // подписи дат остались
    expect([...container.querySelectorAll('.body-chart text')].every((t) => !/^\d+(\.\d)?$/.test(t.textContent))).toBe(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Замеры' }))
    expect(container.textContent).not.toMatch(/84 см/)
  })

  it('лист «Записать»: прошлый вес подставлен, сохранение — новая запись', async () => {
    await saveBodyEntry(userId, { date: shiftYmd(today, -2), weight: 82.5 })
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Записать вес/ }))
    const dlg = await screen.findByRole('dialog')
    const input = within(dlg).getByLabelText('Вес, кг')
    expect(input.value).toBe('82.5')
    fireEvent.click(within(dlg).getByRole('button', { name: 'Вес меньше на 0.1' }))
    expect(input.value).toBe('82.4')
    fireEvent.click(within(dlg).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const b = await getBody(userId)
    expect(b.entries.map((e) => [e.date, e.weight])).toContainEqual([today, 82.4])
  })

  it('пустой вес: «+» начинает с 70 кг, лист веса — без замеров; без записей нет глаза (fb_6114e96f)', async () => {
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    await screen.findByText('Записей пока нет')
    expect(screen.queryByRole('button', { name: 'Скрыть цифры' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Записать вес/ }))
    const dlg = await screen.findByRole('dialog')
    const input = within(dlg).getByLabelText('Вес, кг')
    expect(input.value).toBe('')
    fireEvent.click(within(dlg).getByRole('button', { name: 'Вес больше на 0.1' }))
    expect(input.value).toBe('70')
    expect(within(dlg).queryByText(/Обхваты/)).toBeNull()
  })

  it('лист замеров: тумблер прямо в строке, выключенное поле неактивно, веса нет', async () => {
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Замеры' }))
    fireEvent.click(screen.getByRole('button', { name: /Записать замеры/ }))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).queryByLabelText('Вес, кг')).toBeNull()
    const waist = within(dlg).getByLabelText('Талия, см')
    expect(waist).toBeDisabled()
    fireEvent.click(within(dlg).getByRole('switch', { name: 'Вести: Талия' }))
    await waitFor(() => expect(waist).not.toBeDisabled())
    fireEvent.change(waist, { target: { value: '84' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const b = await getBody(userId)
    expect(b.fields).toEqual(['waist'])
    expect(b.entries[0]).toMatchObject({ waist: 84 })
    expect(b.entries[0].weight).toBeUndefined()
    await waitFor(() => expect([...document.querySelectorAll('.body-row-val')].map((n) => n.textContent)).toContain('84 см'))
  })

  it('цель: «набрать» меньше текущего не сохраняется, «держать» — текущий вес без выбора', async () => {
    await saveBodyEntry(userId, { date: today, weight: 70 })
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Поставить цель' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Набрать' }))
    fireEvent.change(screen.getByLabelText('Целевой вес, кг'), { target: { value: '65' } })
    expect(screen.getByText(/Чтобы набрать, цель должна быть больше текущего веса \(70 кг\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'Держать' }))
    expect(screen.queryByLabelText(/Вес, кг/)).toBeNull()
    expect(screen.getByText(/Держим около 70 кг/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(async () => expect((await getBody(userId)).goal).toMatchObject({ kind: 'keep', target: 70 }))
  })

  it('одна запись — вместо графика подсказка, когда он появится (fb_ac8e85bc)', async () => {
    await saveBodyEntry(userId, { date: today, weight: 70 })
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    expect(await screen.findByText(/График появится со второго взвешивания/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('«Скрыть цифры»: лист не подставляет прошлый вес', async () => {
    await saveBodyEntry(userId, { date: shiftYmd(today, -2), weight: 82.5 })
    await setBodyPrefs(userId, { hide: true })
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Записать вес/ }))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByLabelText('Вес, кг').value).toBe('')
    expect(dlg.textContent).not.toMatch(/82\.5/)
  })
})

describe('BodyScreen: экран «О разделе»', () => {
  it('квадратная кнопка i открывает описание поверх, назад возвращает на экран', async () => {
    const onInnerNav = vi.fn()
    render(<BodyScreen user={{ id: userId }} onBack={() => {}} onInnerNav={onInnerNav} />)
    fireEvent.click(await screen.findByRole('button', { name: 'О разделе' }))
    expect(await screen.findByRole('heading', { name: 'Кто это видит' })).toBeInTheDocument()
    expect(screen.getByText(/В Ленту, круги, рейтинги и Telegram/)).toBeInTheDocument()
    expect(onInnerNav).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getAllByRole('button', { name: /назад/i }).at(-1))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Кто это видит' })).toBeNull())
    expect(onInnerNav).toHaveBeenLastCalledWith(false)
  })
})

