// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const postComment = vi.fn()
const removeComment = vi.fn()
const updateComment = vi.fn()
const setCommentReaction = vi.fn()
vi.mock('../../db/comments.js', () => ({
  postComment: (...a) => postComment(...a),
  removeComment: (...a) => removeComment(...a),
  updateComment: (...a) => updateComment(...a),
  setCommentReaction: (...a) => setCommentReaction(...a),
}))
const showToast = vi.fn()
vi.mock('../ui/Toast.jsx', () => ({ showToast: (...a) => showToast(...a) }))

const { default: CommentThread } = await import('./CommentThread.jsx')

const me = { id: 'me', name: 'Илья' }
const c = (id, user_id, extra = {}) => ({
  id, workout_id: 'w1', user_id, name: user_id === 'me' ? 'Илья' : `Имя-${id}`, known: true,
  avatar_url: null, body: `текст ${id}`, created_at: new Date().toISOString(), ...extra,
})
const setOnline = (v) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => v })

beforeEach(() => {
  setOnline(true)
  for (const f of [postComment, removeComment, updateComment, setCommentReaction, showToast]) f.mockReset()
})
afterEach(() => setOnline(true))

// Меню — удержание пузыря (fb_830c22d6: пузыри; в jsdom — contextmenu, тот же обработчик).
// Пузырь в ветке (не его копия в слое меню).
const bubble = (id) => screen.getAllByText(`текст ${id}`).map((el) => el.closest('.cm-bub')).find((el) => !el.closest('.cmm'))
const openMenu = (id) => fireEvent.contextMenu(bubble(id))
const openReply = (id) => {
  openMenu(id)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Ответить' }))
}
const menuItems = () => screen.getAllByRole('menuitem').map((b) => b.textContent.trim())

const renderThread = (props = {}) => render(
  <CommentThread workoutId="w1" ownerId="owner" comments={[]} me={me} open={false} onOpen={vi.fn()} {...props} />,
)

describe('CommentThread', () => {
  it('«Комментировать» при открытой ветке — только курсор, экран не центрирует (fb_17aad9f1)', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const { rerender } = renderThread({ comments: [c('a', 'x')] })
    rerender(<CommentThread workoutId="w1" ownerId="owner" comments={[c('a', 'x')]} me={me} open onOpen={vi.fn()} focusTick={1} />)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: 'Комментарий' })).toHaveFocus()
    rerender(<CommentThread workoutId="w1" ownerId="owner" comments={[c('a', 'x')]} me={me} open onOpen={vi.fn()} focusTick={2} />)
    expect(scroll).toHaveBeenCalledTimes(1)
    delete Element.prototype.scrollIntoView
  })

  it('пусто и свернуто — ничего не рисует', () => {
    const { container } = renderThread()
    expect(container).toBeEmptyDOMElement()
  })

  it('свернуто: два последних и «Все комментарии (N)»', () => {
    const onOpen = vi.fn()
    renderThread({ comments: [c('a', 'x'), c('b', 'y'), c('d', 'z')], onOpen })
    expect(screen.queryByText('текст a')).toBeNull()
    expect(screen.getByText('текст d')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Все комментарии (3)' }))
    expect(onOpen).toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('незнакомый автор — без перехода в профиль, знакомый — по тапу', () => {
    const onOpenMember = vi.fn()
    renderThread({ open: true, onOpenMember, comments: [c('a', 'x', { known: false, name: 'Сергей' }), c('b', 'y', { name: 'Дима' })] })
    expect(screen.queryByRole('button', { name: 'Сергей' })).toBeNull()
    expect(screen.getByText('Сергей')).toHaveClass('plain')
    fireEvent.click(screen.getByRole('button', { name: 'Дима' }))
    expect(onOpenMember).toHaveBeenCalledWith('y')
  })

  it('меню по удержанию пузыря: чужой — «Ответить/Скопировать» + реакции, свой — «Ответить/Скопировать/Изменить/Удалить», под своей тренировкой чужой — + «Удалить»; «⋯» нет', () => {
    const { rerender } = renderThread({ open: true, comments: [c('a', 'x'), c('b', 'me')] })
    expect(screen.queryByRole('button', { name: 'Действия с комментарием' })).toBeNull()
    fireEvent.click(screen.getByText('текст a')) // короткий тап — ничего
    expect(screen.queryByRole('menu')).toBeNull()
    openMenu('a')
    expect(menuItems()).toEqual(['Ответить', 'Скопировать'])
    expect(bubble('a')).toHaveAttribute('aria-expanded', 'true')
    openMenu('b')
    expect(menuItems()).toEqual(['Ответить', 'Скопировать', 'Изменить', 'Удалить']) // себе — тоже (fb_4cbd8655)
    rerender(<CommentThread workoutId="w1" ownerId="me" comments={[c('a', 'x'), c('b', 'me')]} me={me} open onOpen={vi.fn()} />)
    openMenu('a')
    expect(menuItems()).toEqual(['Ответить', 'Скопировать', 'Удалить'])
  })

  it('удержание пальцем: меню через полсекунды; сдвиг пальца (прокрутка, свайп) — меню нет', () => {
    vi.useFakeTimers()
    try {
      renderThread({ open: true, comments: [c('a', 'x')] })
      fireEvent.pointerDown(bubble('a'), { clientX: 100, clientY: 100 })
      fireEvent.pointerMove(bubble('a'), { clientX: 100, clientY: 130 })
      act(() => { vi.advanceTimersByTime(600) })
      fireEvent.pointerUp(bubble('a'))
      expect(screen.queryByRole('menu')).toBeNull()
      fireEvent.pointerDown(bubble('a'), { clientX: 100, clientY: 100 })
      act(() => { vi.advanceTimersByTime(600) })
      expect(screen.getByRole('menu')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('с клавиатуры: Enter на пузыре — меню', () => {
    renderThread({ open: true, comments: [c('a', 'x')] })
    bubble('a').focus()
    fireEvent.keyDown(bubble('a'), { key: 'Enter' })
    expect(menuItems()).toEqual(['Ответить', 'Скопировать'])
  })

  it('пузыри: свои справа без имени, чужие сериями — имя у первого, аватар у последнего', () => {
    const t = (min) => new Date(Date.now() - (60 - min) * 60000).toISOString()
    renderThread({ open: true, comments: [
      c('a', 'x', { created_at: t(0) }), c('b', 'x', { created_at: t(1) }), c('d', 'me', { created_at: t(2) }),
    ] })
    const items = [...document.querySelectorAll('.cm-item')]
    expect(items.map((el) => el.className.replace('cm-item', '').trim())).toEqual(['first', 'last', 'own first last'])
    expect(screen.getAllByText('Имя-a')).toHaveLength(1) // имя один раз на серию
    expect(items[0].querySelector('.cm-av-gap')).not.toBeNull()
    expect(items[1].querySelector('.avatar-sm')).not.toBeNull()
    expect(items[2].querySelector('.avatar-sm, .cm-name')).toBeNull()
    expect(items[0].querySelector('.cm-name').className.split(' ')).toContainEqual(expect.stringMatching(/^t[1-7]$/))
  })

  it('«Скопировать» — текст в буфер и тост', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderThread({ open: true, comments: [c('a', 'x')] })
    openMenu('a')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Скопировать' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Скопировано' })))
    expect(writeText).toHaveBeenCalledWith('текст a')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('меню: тап по размытому фону и Esc закрывают (фокус — на пузырь); пузырь под меню спрятан, сверху его копия', () => {
    renderThread({ open: true, comments: [c('a', 'me')] })
    openMenu('a')
    expect(bubble('a')).toHaveClass('held')
    const layer = document.querySelector('.cmm')
    expect(layer.querySelector('.cmm-bubble .cm-bub')).toHaveAttribute('aria-hidden', 'true')
    expect(layer.querySelector('.cmm-group')).toHaveClass('right') // свой — справа
    fireEvent.click(screen.getByRole('menu')) // по самому меню — не закрывает
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.click(layer.querySelector('.cmm-scrim'))
    expect(screen.queryByRole('menu')).toBeNull()
    openMenu('a')
    const b = bubble('a')
    const sheetEsc = vi.fn()
    document.addEventListener('keydown', sheetEsc)
    fireEvent.keyDown(document, { key: 'Escape' })
    document.removeEventListener('keydown', sheetEsc)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(sheetEsc).not.toHaveBeenCalled() // Esc не закрывает лист ветки под меню
    expect(b).toHaveFocus()
  })

  it('отправка: строка сразу, поле очищено; ошибка — текст вернулся и тост', async () => {
    let fail
    postComment.mockReturnValue(new Promise((_, rej) => { fail = rej }))
    renderThread({ open: true })
    const box = screen.getByRole('textbox', { name: 'Комментарий' })
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
    fireEvent.change(box, { target: { value: '  в четверг жмем?  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    expect(screen.getByText('в четверг жмем?').closest('.cm-item')).toHaveClass('pending')
    expect(box).toHaveValue('')
    expect(postComment).toHaveBeenCalledWith({ userId: 'me', workoutId: 'w1', ownerId: 'owner', text: 'в четверг жмем?', replyTo: null })
    await act(async () => { fail(new Error('Нет сети.')) })
    expect(box).toHaveValue('в четверг жмем?')
    expect(screen.queryByText('отправка…')).toBeNull()
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ sub: 'Нет сети.' }))
  })

  it('счетчик знаков — только ближе к пределу', () => {
    renderThread({ open: true })
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'я'.repeat(10) } })
    expect(screen.queryByText(/\/ 500/)).toBeNull()
    fireEvent.change(box, { target: { value: 'я'.repeat(420) } })
    expect(screen.getByText('420 / 500')).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'я'.repeat(501) } })
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
  })

  it('без сети — только чтение', () => {
    setOnline(false)
    renderThread({ open: true, comments: [c('a', 'x')] })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Нет сети — комментарии только читать')
  })

  it('удаление своего: ⋯ → Удалить → подтверждение', async () => {
    removeComment.mockResolvedValue(undefined)
    renderThread({ open: true, comments: [c('a', 'me')] })
    openMenu('a')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByText(/Твой комментарий/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(screen.queryByText(/Твой комментарий/)).toBeNull())
    expect(removeComment).toHaveBeenCalledWith({ userId: 'me', comment: expect.objectContaining({ id: 'a' }), ownerId: 'owner' })
  })

  it('правка своего: текст в поле, «Сохранить», сразу новый текст и «изм.»; ошибка — правка вернулась', async () => {
    let fail
    updateComment.mockReturnValue(new Promise((_, rej) => { fail = rej }))
    renderThread({ open: true, comments: [c('a', 'me')] })
    openMenu('a')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Изменить' }))
    const box = screen.getByRole('textbox', { name: 'Комментарий' })
    expect(box).toHaveValue('текст a')
    expect(screen.getByText('Изменяешь комментарий')).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'новый текст' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.getByText('новый текст')).toBeInTheDocument()
    expect(screen.getByText('изм.')).toBeInTheDocument()
    expect(box).toHaveValue('')
    expect(updateComment).toHaveBeenCalledWith({ userId: 'me', comment: expect.objectContaining({ id: 'a' }), ownerId: 'owner', text: 'новый текст' })
    await act(async () => { fail(new Error('Нет сети.')) })
    expect(screen.getByText('текст a')).toBeInTheDocument()
    expect(box).toHaveValue('новый текст')
    expect(screen.getByText('Изменяешь комментарий')).toBeInTheDocument()
  })

  it('правка без изменений и отмена — сервер не трогаем', () => {
    renderThread({ open: true, comments: [c('a', 'me')] })
    openMenu('a')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Изменить' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(updateComment).not.toHaveBeenCalled()
    expect(screen.queryByText('Изменяешь комментарий')).toBeNull()
    openMenu('a')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Изменить' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отменить правку' }))
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.queryByText('изм.')).toBeNull()
  })

  it('метка «изм.» с сервера', () => {
    renderThread({ open: true, comments: [c('a', 'x', { edited_at: '2026-10-19T12:00:00Z' })] })
    expect(screen.getByText('изм.')).toBeInTheDocument()
  })

  it('реакции: таблетки по видам; тап — поставить/снять; на своем — только счетчик; без сети — неактивно (fb_4cbd8655)', async () => {
    let done
    setCommentReaction.mockReturnValue(new Promise((res) => { done = res }))
    const { rerender } = renderThread({ open: true, comments: [
      c('a', 'x', { reactions: { heart: 2, laugh: 1 }, my_reaction: 'laugh' }), c('b', 'me', { reactions: { fire: 1 } })] })
    const heart = screen.getByRole('button', { name: 'Сердце: 2' })
    expect(screen.getByRole('button', { name: 'Смешно: 1, убрать' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Огонь: 1' })).toBeDisabled()
    // одна от человека: сердце вместо смешного
    fireEvent.click(heart)
    expect(screen.getByRole('button', { name: 'Сердце: 3, убрать' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Смешно/ })).toBeNull()
    expect(setCommentReaction).toHaveBeenCalledWith({ userId: 'me', comment: expect.objectContaining({ id: 'a' }), ownerId: 'owner', kind: 'heart' })
    await act(async () => { done({}) })
    setOnline(false)
    act(() => { window.dispatchEvent(new Event('offline')) })
    rerender(<CommentThread workoutId="w1" ownerId="other" comments={[c('a', 'x', { reactions: { heart: 3 }, my_reaction: 'heart' })]} me={me} open onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Сердце: 3, убрать' })).toBeDisabled()
  })

  it('ответ: «Ответить» и у своего (fb_4cbd8655); из свернутой ветки — раскрывает', () => {
    const onOpen = vi.fn()
    renderThread({ comments: [c('a', 'x'), c('b', 'me')], onOpen })
    openReply('b')
    expect(onOpen).toHaveBeenCalled()
  })

  it('ответ: отправка уходит с исходным, полоска пропадает, у новой строки цитата', async () => {
    let done
    postComment.mockReturnValue(new Promise((res) => { done = res }))
    renderThread({ open: true, comments: [c('a', 'x')] })
    openReply('a')
    expect(screen.getByText('Ответ: Имя-a')).toBeInTheDocument()
    const box = screen.getByRole('textbox', { name: 'Комментарий' })
    expect(box).toHaveFocus()
    expect(box).toHaveAttribute('placeholder', 'Написать ответ')
    fireEvent.change(box, { target: { value: 'спасибо!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    expect(postComment).toHaveBeenCalledWith(expect.objectContaining({ text: 'спасибо!', replyTo: expect.objectContaining({ id: 'a' }) }))
    expect(screen.queryByText('Ответ: Имя-a')).toBeNull()
    // цитата у отправляемой строки: имя и начало исходного
    expect(document.querySelector('.cm-quote')).toHaveTextContent('Имя-aтекст a')
    await act(async () => { done(c('n', 'me')) })
  })

  it('ответ свайпом влево — полоска «Ответ» и курсор; свой тоже свайпается (fb_4cbd8655)', () => {
    renderThread({ open: true, comments: [c('a', 'x'), c('b', 'me')] })
    const [mine, theirs] = [document.querySelectorAll('.cm-item')[1], document.querySelectorAll('.cm-item')[0]]
    expect(mine.querySelector('.cm-swipe-ico')).not.toBeNull()
    const at = (x) => ({ touches: [{ clientX: x, clientY: 50 }] })
    fireEvent.touchStart(theirs, at(300))
    fireEvent.touchMove(theirs, at(280))
    fireEvent.touchMove(theirs, at(220))
    fireEvent.touchEnd(theirs, { touches: [] })
    expect(screen.getByText('Ответ: Имя-a')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Комментарий' })).toHaveFocus()
  })

  it('повторный «Ответить» тому же — снова курсор в поле; отмена ответа — подсказка «Написать комментарий» (fb_244e1492)', () => {
    renderThread({ open: true, comments: [c('a', 'x')] })
    openReply('a')
    screen.getByRole('button', { name: 'Отменить ответ' }).focus() // клавиатуру убрали
    openReply('a')
    expect(screen.getByRole('textbox', { name: 'Комментарий' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Отменить ответ' }))
    expect(screen.getByRole('textbox', { name: 'Комментарий' })).toHaveAttribute('placeholder', 'Написать комментарий')
  })

  it('ответ: ошибка — текст и адресат вернулись; ✕ — отмена ответа', async () => {
    postComment.mockRejectedValue(new Error('Нет сети.'))
    renderThread({ open: true, comments: [c('a', 'x')] })
    openReply('a')
    fireEvent.change(screen.getByRole('textbox', { name: 'Комментарий' }), { target: { value: 'ну' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(showToast).toHaveBeenCalled())
    expect(screen.getByText('Ответ: Имя-a')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Комментарий' })).toHaveValue('ну')
    fireEvent.click(screen.getByRole('button', { name: 'Отменить ответ' }))
    expect(screen.queryByText('Ответ: Имя-a')).toBeNull()
  })

  it('цитата с сервера: исходный в ветке — имя и текст, удален — только имя', () => {
    renderThread({ open: true, comments: [
      c('a', 'x'),
      c('r1', 'y', { reply_to: 'a', reply_to_user: 'x', reply_to_name: 'Имя-a' }),
      c('r2', 'y', { reply_to: null, reply_to_user: 'z', reply_to_name: 'Ушедший' }),
    ] })
    const quotes = document.querySelectorAll('.cm-quote')
    expect(quotes).toHaveLength(2)
    expect(quotes[0]).toHaveTextContent('Имя-aтекст a')
    expect(quotes[1]).toHaveTextContent('Ушедший')
  })

  it('без сети «Ответить» нет', () => {
    setOnline(false)
    renderThread({ open: true, comments: [c('a', 'x')] })
    openMenu('a')
    expect(screen.queryByRole('menuitem', { name: 'Ответить' })).toBeNull()
  })

  it('реакция из полоски над пузырем: тап — ставит и закрывает меню, повторно — снимает; ошибка — откат и тост', async () => {
    let fail
    setCommentReaction.mockReturnValue(new Promise((_, rej) => { fail = rej }))
    renderThread({ open: true, comments: [c('a', 'x')] })
    expect(document.querySelector('.cm-like')).toBeNull()
    openMenu('a')
    const strip = screen.getByRole('group', { name: 'Реакции' })
    expect([...strip.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['❤️', '😂', '👍', '🔥', '😮'])
    fireEvent.click(screen.getByRole('button', { name: 'Класс' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('button', { name: 'Класс: 1, убрать' })).toBeInTheDocument()
    openMenu('a')
    expect(screen.getByRole('button', { name: 'Класс' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Класс' }))
    expect(setCommentReaction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: null }))
    await act(async () => { fail(new Error('Нет сети.')) })
    expect(showToast).toHaveBeenCalled()
  })

  it('свой комментарий и без сети: полоски реакций нет', () => {
    const { unmount } = renderThread({ open: true, comments: [c('a', 'me')] })
    openMenu('a')
    expect(screen.queryByRole('group', { name: 'Реакции' })).toBeNull()
    unmount()
    setOnline(false)
    renderThread({ open: true, comments: [c('b', 'x')] })
    openMenu('b')
    expect(screen.queryByRole('group', { name: 'Реакции' })).toBeNull()
  })

  it('время в углу — по часам; плашка дня — когда ветка тянется на другой день (fb_afd6d919)', () => {
    const now = new Date()
    const at = (daysAgo, h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m).toISOString()
    renderThread({ open: true, comments: [c('a', 'x', { created_at: at(1, 9, 5) }), c('b', 'y', { created_at: at(0, 14, 30) })] })
    expect(screen.getByText('09:05')).toBeInTheDocument()
    expect(screen.getByText('14:30')).toBeInTheDocument()
    expect([...document.querySelectorAll('.cm-day')].map((el) => el.textContent)).toEqual(['Вчера', 'Сегодня'])
  })

  it('двойной тап по чужому пузырю — ❤️, по своему — ничего; одиночный тап — ничего', () => {
    setCommentReaction.mockReturnValue(new Promise(() => {}))
    renderThread({ open: true, comments: [c('a', 'x'), c('b', 'me')] })
    fireEvent.click(bubble('a'))
    expect(setCommentReaction).not.toHaveBeenCalled()
    fireEvent.click(bubble('a'))
    expect(setCommentReaction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'heart', comment: expect.objectContaining({ id: 'a' }) }))
    expect(screen.getByRole('button', { name: 'Сердце: 1, убрать' })).toBeInTheDocument()
    fireEvent.click(bubble('b'))
    fireEvent.click(bubble('b'))
    expect(setCommentReaction).toHaveBeenCalledTimes(1)
  })
})
