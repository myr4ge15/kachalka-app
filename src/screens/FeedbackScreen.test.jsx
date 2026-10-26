// @vitest-environment jsdom
// «Написать разработчику»: отправка с контекстом, скриншот, свои обращения с ответом.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FeedbackScreen from './FeedbackScreen.jsx'
import { showToast } from '../components/ui/Toast.jsx'
import { FeedbackError } from '../lib/feedbackApi.js'

const sync = vi.hoisted(() => ({ online: true }))
vi.mock('../db/sync.js', () => ({ useSyncStatus: () => sync }))
vi.mock('../components/ui/Toast.jsx', () => ({ showToast: vi.fn() }))
vi.mock('../lib/feedbackApi.js', () => ({
  FeedbackError: class FeedbackError extends Error {},
  submitFeedback: vi.fn(), listMyFeedback: vi.fn(), ackMyFeedback: vi.fn(),
  reopenFeedback: vi.fn(), feedbackMedia: vi.fn(), appendFeedback: vi.fn(), attachUploadedScreenshots: vi.fn(),
  uploadAttachment: vi.fn(), discardAttachments: vi.fn(),
}))

const USER = { id: 'me', name: 'Маша' }
const ROW = {
  id: 'f1', body: 'Пропал подход', status: 'resolved', reply: 'Исправлено в 6.11.1',
  replied_at: '2026-10-05T12:00:00Z', reply_seen_at: null, has_screenshot: true, created_at: '2026-10-05T10:00:00Z',
}

// Строка «Моих обращений» свернута — раскрыть тапом по шапке (9.3.3: новый ответ не раскрывает сам).
const expand = async (name = /Пропал подход/) => userEvent.click(await screen.findByRole('button', { name }))
// Форма под «Отправить обращение» (26.10.2026): раскрывается сама, когда список пуст — после загрузки.
const formReady = () => screen.findByLabelText('Что случилось?')

function setup(over = {}, props = {}) {
  const api = {
    submit: vi.fn(async () => ({ id: 'new', delivered: true })),
    list: vi.fn(async () => []),
    ack: vi.fn(),
    reopen: vi.fn(async () => ({ delivered: true })),
    append: vi.fn(async () => ({ delivered: true })),
    media: vi.fn(async (id, kind, n) => `blob:${id}-${kind}-${n}`),
    upload: vi.fn(async (uid, f) => `${uid}/${f.name}`), // предзагрузка: путь в Storage
    discard: vi.fn(),
    ...over,
  }
  render(<FeedbackScreen user={USER} onBack={() => {}} api={api} {...props} />)
  return api
}

beforeEach(() => {
  vi.clearAllMocks()
  sync.online = true
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview')
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe('FeedbackScreen', () => {
  it('«Обновить список» и возврат в приложение перечитывают обращения (fb_6e2e0d6c)', async () => {
    const list = vi.fn(async () => [])
    setup({ list })
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Пока пусто.')).toBeInTheDocument()

    list.mockResolvedValue([ROW])
    await userEvent.click(screen.getByRole('button', { name: 'Обновить список' }))
    expect(await screen.findByRole('button', { name: /Пропал подход/ })).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)

    // вкладка снова видна (вернулись из фона) — тихий повторный запрос
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3))
  })

  it('без сети «Обновить список» неактивна', async () => {
    sync.online = false
    setup()
    expect(screen.getByRole('button', { name: 'Обновить список' })).toBeDisabled()
  })

  it('контекст: вкладка, с которой пришли в Настройки, а не всегда «Профиль»', async () => {
    const api = setup({}, { fromScreen: 'feed' })
    await formReady() // пустой список обращений — форма раскрыта сама
    await userEvent.type(screen.getByLabelText('Что случилось?'), 'Не грузится')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
    expect(api.submit.mock.calls[0][1].context.screen).toBe('Лента')
  })

  it('отправка: текст + контекст (версия, устройство, экран), форма очищается', async () => {
    const api = setup()
    await formReady() // пустой список обращений — форма раскрыта сама
    const send = screen.getByRole('button', { name: 'Отправить' })
    expect(send).toBeDisabled() // пусто — нечего отправлять
    await userEvent.type(screen.getByLabelText('Что случилось?'), 'Пропал подход')
    await userEvent.click(send)
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
    const [uid, payload] = api.submit.mock.calls[0]
    expect(uid).toBe('me')
    expect(payload.body).toBe('Пропал подход')
    expect(payload.paths).toEqual([])
    expect(payload.context).toMatchObject({ screen: 'Профиль', standalone: false })
    expect(payload.context.version).toBeTruthy()
    expect(payload.context.device).toBeTruthy()
    // Ушло — форма свернута под «Отправить обращение», раскрытая — пустая.
    await userEvent.click(await screen.findByRole('button', { name: /Отправить обращение/, expanded: false }))
    expect(screen.getByLabelText('Что случилось?')).toHaveValue('')
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Отправлено' }))
    expect(api.list).toHaveBeenCalledTimes(2) // при открытии и после отправки
  })

  it('журналы устройства: только с галочкой, в context.logs; без нее не читаются', async () => {
    const readLogs = vi.fn(async () => ({
      swipes: [{ at: '2026-10-23T12:24:00Z', kind: 'back', p: 0.17, v: 0, flick: 0, moves: 14 }],
      pushes: [{ at: Date.parse('2026-10-23T12:20:00Z'), who: 'sw', ev: 'click', detail: '/#feed' }],
    }))
    const api = setup({ readLogs })
    await formReady() // пустой список обращений — форма раскрыта сама
    await userEvent.type(screen.getByLabelText('Что случилось?'), 'Свайп')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
    expect(api.submit.mock.calls[0][1].context.logs).toBeUndefined()
    expect(readLogs).not.toHaveBeenCalled()

    await userEvent.click(await screen.findByRole('button', { name: /Отправить обращение/, expanded: false }))
    await userEvent.type(screen.getByLabelText('Что случилось?'), 'Свайп')
    await userEvent.click(screen.getByRole('checkbox', { name: /Приложить журналы/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(2))
    const { logs } = api.submit.mock.calls[1][1].context
    expect(logs.swipe).toHaveLength(1)
    expect(logs.swipe[0]).toMatch(/вернулся · 17%/)
    expect(logs.push[0]).toMatch(/sw click · \/#feed$/)
    await userEvent.click(await screen.findByRole('button', { name: /Отправить обращение/, expanded: false }))
    expect(screen.getByRole('checkbox', { name: /Приложить журналы/ })).not.toBeChecked()
  })

  it('скриншот: грузится сразу после выбора, «Убрать» удаляет загруженное, отправка — путями', async () => {
    const api = setup()
    await formReady() // пустой список обращений — форма раскрыта сама
    const file = new File(['x'], 'shot.png', { type: 'image/png' })
    await userEvent.upload(screen.getByTestId('fb-file'), file)
    expect(await screen.findByAltText('Скриншот к обращению')).toHaveAttribute('src', 'blob:preview')
    expect(await screen.findByRole('img', { name: 'Загружено' })).toBeTruthy()
    expect(api.upload).toHaveBeenCalledWith('me', file, expect.objectContaining({ onBytes: expect.any(Function) }))
    await userEvent.click(screen.getByRole('button', { name: 'Убрать скриншот' }))
    expect(screen.queryByAltText('Скриншот к обращению')).toBeNull()
    expect(api.discard).toHaveBeenCalledWith(['me/shot.png'])
    await userEvent.upload(screen.getByTestId('fb-file'), file)
    await userEvent.type(screen.getByLabelText('Что случилось?'), 'см. скрин')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(api.submit.mock.calls[0][1].paths).toEqual(['me/shot.png']))
    expect(api.discard).toHaveBeenCalledTimes(1) // отправленное не удаляется
  })

  it('«Отправить» ждет догрузки; не загрузилось — не шлем, «Повторить» догружает', async () => {
    let finish
    const upload = vi.fn()
      .mockImplementationOnce(() => new Promise((ok) => { finish = ok }))
      .mockRejectedValueOnce(new Error('сеть'))
      .mockResolvedValue('me/b.png')
    const api = setup({ upload })
    await formReady() // пустой список обращений — форма раскрыта сама
    await userEvent.upload(screen.getByTestId('fb-file'), [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })])
    await userEvent.type(screen.getByLabelText('Что случилось?'), 'ошибка')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    expect(await screen.findByText(/Догружаю/)).toBeTruthy()
    finish('me/a.png')
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не отправилось', sub: expect.stringMatching(/Повторить/) })))
    expect(api.submit).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Повторить загрузку 2' }))
    await screen.findByRole('img', { name: 'Загружено 2' })
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(api.submit.mock.calls[0][1].paths).toEqual(['me/a.png', 'me/b.png']))
  })

  it('есть обращения — форма свернута под «Отправить обращение», тап раскрывает и сворачивает', async () => {
    setup({ list: vi.fn(async () => [ROW]) })
    const row = screen.getByRole('button', { name: /Отправить обращение/ })
    expect(row).toHaveAttribute('aria-expanded', 'false') // список грузится — свернута, не прыгает
    await screen.findByRole('button', { name: /Пропал подход/ })
    expect(screen.queryByLabelText('Что случилось?')).toBeNull()
    await userEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    await userEvent.type(screen.getByLabelText('Что случилось?'), 'идея')
    await userEvent.click(row)
    expect(screen.queryByLabelText('Что случилось?')).toBeNull()
    expect(row).toHaveTextContent('есть черновик') // набранное не пропало
    await userEvent.click(row)
    expect(screen.getByLabelText('Что случилось?')).toHaveValue('идея')
  })

  it('обращений нет — форма раскрыта сама', async () => {
    setup()
    expect(await screen.findByLabelText('Что случилось?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Отправить обращение/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('ошибка сервера — тост с текстом, введенное не теряется', async () => {
    const api = setup({ submit: vi.fn(async () => { throw new FeedbackError('Много обращений подряд.') }) })
    await formReady() // пустой список обращений — форма раскрыта сама
    await userEvent.type(screen.getByLabelText('Что случилось?'), 'идея')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ sub: 'Много обращений подряд.' })))
    expect(screen.getByLabelText('Что случилось?')).toHaveValue('идея')
    expect(api.submit).toHaveBeenCalledTimes(1)
  })

  it('офлайн: отправка недоступна, с пояснением', async () => {
    sync.online = false
    const api = setup()
    await userEvent.type(screen.getByLabelText('Что случилось?'), 'идея')
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Нет связи')
    expect(api.list).not.toHaveBeenCalled()
  })

  it('свои обращения: статус, ответ с меткой «новый», ответ подтверждается прочитанным', async () => {
    const api = setup({ list: vi.fn(async () => [ROW]) })
    expect(await screen.findByText('новый')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Пропал подход/ })).toHaveAttribute('aria-expanded', 'false')
    await expand()
    expect(screen.getByText('Исправлено в 6.11.1')).toBeTruthy()
    expect(screen.getByText('Решено')).toBeTruthy()
    expect(screen.queryByText('новый')).toBeNull() // раскрыли — прочитано, метка гаснет
    expect(screen.getByText('со скриншотом')).toBeTruthy()
    expect(api.ack).toHaveBeenCalledTimes(1)
  })

  it('прочитанный ответ без метки и без повторного ack; пустой список', async () => {
    const api = setup({ list: vi.fn(async () => [{ ...ROW, reply_seen_at: '2026-10-05T13:00:00Z' }]) })
    expect(await screen.findByText('Исправлено в 6.11.1')).toBeTruthy()
    expect(screen.queryByText('новый')).toBeNull()
    expect(api.ack).not.toHaveBeenCalled()
  })
})

describe('FeedbackScreen — ответ из Telegram и переоткрытие (v6.12.0)', () => {
  it('ответ из одних фото: картинки грузятся, тап — на весь экран; метка «новый»', async () => {
    const api = setup({ list: vi.fn(async () => [{ ...ROW, reply: null, reply_photos: 2 }]) })
    await expand()
    const shots = await screen.findAllByRole('button', { name: /Скриншот от разработчика \d из 2/ })
    expect(shots).toHaveLength(2)
    expect(api.media).toHaveBeenCalledWith('f1', 'reply', 0)
    expect(api.media).toHaveBeenCalledWith('f1', 'reply', 1)
    await userEvent.click(shots[1])
    expect(screen.getByRole('dialog', { name: 'Скриншот от разработчика' }).querySelector('img'))
      .toHaveAttribute('src', 'blob:f1-reply-1')
  })

  it('«Не помогло»: комментарий обязателен, уходит на сервер, список перечитан', async () => {
    const api = setup({ list: vi.fn(async () => [ROW]) })
    await expand()
    await userEvent.click(await screen.findByRole('button', { name: 'Не помогло — открыть снова' }))
    const send = screen.getByRole('button', { name: 'Открыть снова' })
    expect(send).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Что не так?'), 'Все еще пропадает')
    await userEvent.click(send)
    await waitFor(() => expect(api.reopen).toHaveBeenCalledWith('f1', 'Все еще пропадает'))
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Обращение открыто снова' }))
    expect(api.list).toHaveBeenCalledTimes(2)
  })

  it('открытое снова: комментарий виден, прошлый ответ помечен, кнопки нет; лимит исчерпан — тоже нет', async () => {
    setup({ list: vi.fn(async () => [
      { ...ROW, status: 'new', reopen_note: 'Не помогло', reopened_at: '2026-10-05T13:00:00Z', reopen_count: 1 },
      { ...ROW, id: 'f2', body: 'Другое', reopen_count: 3 },
    ]) })
    await expand()
    expect(await screen.findByText('Открыто снова: Не помогло')).toBeTruthy()
    expect(screen.getByText(/Прошлый ответ/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Не помогло — открыть снова' })).toBeNull()
  })

  it('ошибка переоткрытия — тост с текстом, форма остается', async () => {
    const reopen = vi.fn(async () => { throw new FeedbackError('Обращение уже открывали снова 3 раза — напиши новое.') })
    setup({ list: vi.fn(async () => [ROW]), reopen })
    await expand()
    await userEvent.click(await screen.findByRole('button', { name: 'Не помогло — открыть снова' }))
    await userEvent.type(screen.getByLabelText('Что не так?'), 'опять')
    await userEvent.click(screen.getByRole('button', { name: 'Открыть снова' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ sub: expect.stringContaining('3 раза') })))
    expect(screen.getByLabelText('Что не так?')).toHaveValue('опять')
  })

  // v8.6.0 (обращение fb_71127755): дописать к открытому, а не новым обращением.
  it('«Дополнить» открытое: текст уходит в то же обращение, список перечитан', async () => {
    const api = setup({ list: vi.fn(async () => [{ ...ROW, status: 'new', reply: null, replied_at: null }]) })
    await userEvent.click(await screen.findByRole('button', { name: /Пропал подход/ })) // свернуто — раскрыть
    await userEvent.click(await screen.findByRole('button', { name: 'Дополнить' }))
    expect(screen.queryByRole('button', { name: 'Не помогло — открыть снова' })).toBeNull()
    const send = screen.getByRole('button', { name: 'Дописать' })
    expect(send).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Что добавить?'), 'по чату — можно комменты')
    await userEvent.click(send)
    await waitFor(() => expect(api.append).toHaveBeenCalledWith('f1', 'по чату — можно комменты'))
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Дополнение отправлено' }))
    expect(api.list).toHaveBeenCalledTimes(2)
  })

  it('дополнения видны под текстом; у решенного и при 5 дополнениях кнопки нет', async () => {
    const adds = (k) => Array.from({ length: k }, (_, i) => ({ n: i + 1, body: `доп ${i + 1}`, created_at: '2026-10-15T01:25:00Z' }))
    setup({ list: vi.fn(async () => [
      { ...ROW, id: 'f1', status: 'in_progress', reply: null, replied_at: null, additions: adds(2) },
      { ...ROW, id: 'f2', status: 'new', reply: null, replied_at: null, additions: adds(5) },
      { ...ROW, id: 'f3', reply_seen_at: '2026-10-05T13:00:00Z' }, // решено — только «открыть снова»
    ]) })
    for (const b of await screen.findAllByRole('button', { name: /Пропал подход/ })) await userEvent.click(b)
    expect(screen.getAllByText('доп 2')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Дополнить' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Не помогло — открыть снова' })).toBeNull() // решенное — в «Закрытых»
    await userEvent.click(screen.getByRole('tab', { name: /Закрытые · 1/ }))
    await userEvent.click(screen.getByRole('button', { name: /Пропал подход/ }))
    expect(screen.getAllByRole('button', { name: 'Не помогло — открыть снова' })).toHaveLength(1)
  })
})

describe('FeedbackScreen — компактный список (16.10)', () => {
  const rows = [
    { ...ROW, id: 'o1', status: 'new', body: 'Открытое без ответа', reply: null, replied_at: null, screenshot_count: 2,
      additions: [{ n: 1, body: 'доп', created_at: '2026-10-15T01:25:00Z' }] },
    { ...ROW, id: 'c1', body: 'Закрытое', reply_seen_at: '2026-10-05T13:00:00Z' },
  ]

  it('свернутая строка: начало текста и значки; тап раскрывает и сворачивает', async () => {
    setup({ list: vi.fn(async () => rows) })
    const toggle = await screen.findByRole('button', { name: /Открытое без ответа/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText('Вложений: 2')).toBeTruthy()
    expect(screen.getByLabelText('Дополнений: 1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Дополнить' })).toBeNull()
    expect(screen.queryByText('Закрытое')).toBeNull() // другая вкладка
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Дополнить' })).toBeTruthy()
    await userEvent.click(toggle)
    expect(screen.queryByRole('button', { name: 'Дополнить' })).toBeNull()
  })

  it('закрытые: прочитанный ответ виден одной строкой в свернутом', async () => {
    setup({ list: vi.fn(async () => rows) })
    await userEvent.click(await screen.findByRole('tab', { name: /Закрытые · 1/ }))
    expect(screen.getByText('Исправлено в 6.11.1')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Закрытое/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('новый фокус на открытом экране — его вкладка и раскрытие (fb_bb404b7e)', async () => {
    const api = { submit: vi.fn(), list: vi.fn(async () => rows), ack: vi.fn(), reopen: vi.fn(), append: vi.fn(), media: vi.fn() }
    const { rerender } = render(<FeedbackScreen user={USER} onBack={() => {}} api={api} focusId="o1" />)
    expect(await screen.findByRole('tab', { name: /Открытые/ })).toHaveAttribute('aria-selected', 'true')
    rerender(<FeedbackScreen user={USER} onBack={() => {}} api={api} focusId="c1" />)
    expect(screen.getByRole('tab', { name: /Закрытые/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Не помогло — открыть снова' })).toBeTruthy() // раскрыто
  })

  it('пришли пушем к закрытому — открыта его вкладка, обращение раскрыто', async () => {
    setup({ list: vi.fn(async () => rows) }, { focusId: 'c1' })
    expect(await screen.findByRole('tab', { name: /Закрытые/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Не помогло — открыть снова' })).toBeTruthy()
  })
})

it('несколько файлов: повторный выбор добавляет, удаление убирает только выбранный', async () => {
  const api = setup()
  await formReady() // пустой список обращений — форма раскрыта сама
  const a = new File(['a'], 'a.png', { type: 'image/png' })
  const b = new File(['b'], 'b.png', { type: 'image/png' })
  const c = new File(['c'], 'c.png', { type: 'image/png' })
  await userEvent.upload(screen.getByTestId('fb-file'), [a, b])
  await userEvent.upload(screen.getByTestId('fb-file'), c)
  await userEvent.click(screen.getByRole('button', { name: 'Убрать скриншот 2' }))
  await userEvent.type(screen.getByLabelText('Что случилось?'), 'Ошибка')
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  await waitFor(() => expect(api.submit.mock.calls[0][1].paths).toEqual(['me/a.png', 'me/c.png']))
})

// 16.10 (fb_a4e36c94): вложения — прямо в «Дополнить», можно и без текста.
it('«Дополнить»: только скриншот, без текста; ошибка сохраняет выбор', async () => {
  const attach = vi.fn().mockRejectedValueOnce(new FeedbackError('Нет связи')).mockResolvedValue({ delivered: true })
  const api = setup({ list: vi.fn(async () => [{ ...ROW, status: 'new', reply: null, replied_at: null, screenshot_count: 1 }]), attach })
  await userEvent.click(await screen.findByRole('button', { name: /Пропал подход/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Дополнить' }))
  const send = screen.getByRole('button', { name: 'Дописать' })
  expect(send).toBeDisabled()
  const file = new File(['x'], 'more.png', { type: 'image/png' })
  await userEvent.upload(screen.getByTestId('fb-file-f1'), file)
  expect(send).toBeEnabled()
  await userEvent.click(send)
  await waitFor(() => expect(attach).toHaveBeenCalledTimes(1))
  expect(api.append).not.toHaveBeenCalled()
  expect(screen.getByAltText('Скриншот к обращению')).toBeTruthy() // выбор не потерян
  await userEvent.click(screen.getByRole('button', { name: 'Дописать' }))
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
  expect(attach).toHaveBeenLastCalledWith('me', 'f1', ['me/more.png'])
  expect(screen.queryByRole('button', { name: 'Дописать' })).toBeNull() // форма закрылась
})

it('«Дополнить»: текст и скриншот уходят вместе', async () => {
  const attach = vi.fn(async () => ({ delivered: true }))
  const api = setup({ list: vi.fn(async () => [{ ...ROW, status: 'new', reply: null, replied_at: null }]), attach })
  await userEvent.click(await screen.findByRole('button', { name: /Пропал подход/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Дополнить' }))
  await userEvent.type(screen.getByLabelText('Что добавить?'), 'вот еще')
  const file = new File(['x'], 'b.png', { type: 'image/png' })
  await userEvent.upload(screen.getByTestId('fb-file-f1'), file)
  await userEvent.click(screen.getByRole('button', { name: 'Дописать' }))
  await waitFor(() => expect(attach).toHaveBeenCalledWith('me', 'f1', ['me/b.png']))
  expect(api.append).toHaveBeenCalledWith('f1', 'вот еще')
})

it('«Открыть снова»: без комментария одни файлы не уходят; при 5 вложениях выбора нет', async () => {
  const seen = { ...ROW, reply_seen_at: '2026-10-05T13:00:00Z' } // прочитано — свернуто
  const api = setup({ list: vi.fn(async () => [seen, { ...seen, id: 'f2', body: 'Полное', screenshot_count: 5 }]) })
  await userEvent.click(await screen.findByRole('tab', { name: /Закрытые/ }))
  await userEvent.click(screen.getByRole('button', { name: /Пропал подход/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Не помогло — открыть снова' }))
  await userEvent.upload(screen.getByTestId('fb-file-f1'), new File(['x'], 'c.png', { type: 'image/png' }))
  expect(screen.getByRole('button', { name: 'Открыть снова' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Отмена' }))
  await waitFor(() => expect(api.discard).toHaveBeenCalledWith(['me/c.png'])) // отменили — загруженное убираем
  await userEvent.click(screen.getByRole('button', { name: /Полное/ }))
  expect(screen.queryByTestId('fb-file-f2')).toBeNull()
})

// 16.10 (fb_bd776cf0) / 9.3.3: раскрытое сворачивается тапом по шапке; отдельной «Свернуть» нет.
it('тап по шапке раскрывает и сворачивает, кнопки «Свернуть» нет', async () => {
  setup({ list: vi.fn(async () => [{ ...ROW, status: 'new', reply: null, replied_at: null }]) })
  await expand()
  expect(screen.getByRole('button', { name: 'Дополнить' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Свернуть/ })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: /Новое/ }))
  expect(screen.queryByRole('button', { name: 'Дополнить' })).toBeNull()
  expect(screen.getByRole('button', { name: /Пропал подход/ })).toHaveAttribute('aria-expanded', 'false')
})
