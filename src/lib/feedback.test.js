import { describe, expect, it } from 'vitest'
import {
  myFeedbackTab, attachmentProblem, attachmentProblemText, fmtFileSize, videoPosterSrc, sniffMediaType, videoExt, bodyProblem, buildContext, cleanBody, contextLine, describeDevice, feedbackErrorText, isWebKit26Plus,
  fmtFeedbackDate, hasUnreadReply, isOpenStatus, isFinalStatus, STATUS_LABEL, openCount, unreadReplies, FEEDBACK_MAX,
  canReopen, hasReply, isStaleReply, reopenProblem, REOPEN_LIMIT, REOPEN_MAX, groupAttachments, laterLabel,
} from './feedback.js'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'
const WIN_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0'
const YA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 YaBrowser/24.7.1 Mobile Safari/537.36'

describe('describeDevice', () => {
  it('iPhone — версия iOS, без дубля «Safari»', () => {
    expect(describeDevice(IPHONE)).toBe('iPhone · iOS 17.5')
  })
  it('Android и браузер с версией', () => {
    expect(describeDevice(ANDROID)).toBe('Android 14 · Chrome 129')
    expect(describeDevice(YA)).toBe('Android 13 · Яндекс 24')
  })
  it('Edge не путается с Chrome', () => {
    expect(describeDevice(WIN_EDGE)).toBe('Windows · Edge 129')
  })
  it('мусор — «неизвестно»', () => {
    expect(describeDevice('')).toBe('неизвестно')
    expect(describeDevice(undefined)).toBe('неизвестно')
  })
})

describe('buildContext', () => {
  it('версия, устройство, режим, экран по-русски, размер окна', () => {
    expect(buildContext({
      version: '6.11.0', userAgent: IPHONE, standalone: true,
      viewport: { w: 390.4, h: 844 }, screen: 'profile', online: true,
    })).toEqual({
      version: '6.11.0', device: 'iPhone · iOS 17.5', standalone: true, screen: 'Профиль', viewport: '390×844',
    })
  })
  it('экран между вкладкой и формой — «Лента → Профиль» (fb_89880c2d)', () => {
    expect(buildContext({ screen: 'feed', via: 'profile' }).screen).toBe('Лента → Профиль')
    expect(buildContext({ screen: 'profile', via: 'profile' }).screen).toBe('Профиль')
    expect(buildContext({ screen: 'profile', via: null }).screen).toBe('Профиль')
  })
  it('неизвестный экран — как есть (обрезан), офлайн помечается', () => {
    const c = buildContext({ screen: 'x'.repeat(50), online: false })
    expect(c.screen).toHaveLength(30)
    expect(c.online).toBe(false)
    expect(c.viewport).toBeUndefined()
  })
})

describe('текст обращения', () => {
  it('cleanBody обрезает и нормализует переводы строк', () => {
    expect(cleanBody('  a\r\nb\rc  ')).toBe('a\nb\nc')
    expect(cleanBody(null)).toBe('')
  })
  it('bodyProblem — пусто/длинно/ок', () => {
    expect(bodyProblem('   ')).toBe('empty')
    expect(bodyProblem('x'.repeat(FEEDBACK_MAX + 1))).toBe('too_long')
    expect(bodyProblem(` ${'x'.repeat(FEEDBACK_MAX)} `)).toBeNull()
  })
})

describe('ответы и статусы', () => {
  const r = (o) => ({ reply: 'ок', replied_at: '2026-10-05T10:00:00Z', reply_seen_at: null, ...o })
  it('новый ответ — непрочитан, пока не увиден после него', () => {
    expect(hasUnreadReply(r())).toBe(true)
    expect(hasUnreadReply(r({ reply_seen_at: '2026-10-05T11:00:00Z' }))).toBe(false)
    expect(hasUnreadReply(r({ reply_seen_at: '2026-10-05T09:00:00Z' }))).toBe(true)
    expect(hasUnreadReply(r({ reply: null }))).toBe(false)
    expect(hasUnreadReply(null)).toBe(false)
  })
  it('счетчики', () => {
    expect(unreadReplies([r(), r({ reply: null }), r()])).toBe(2)
    expect(unreadReplies(null)).toBe(0)
    expect(openCount([{ status: 'new' }, { status: 'in_progress' }, { status: 'resolved' }])).toBe(2)
    expect(isOpenStatus('declined')).toBe(false)
    // «В бэклоге» (27.10.2026) — рассмотрено, но открыто: дополнить можно, в «Моих обращениях» — среди открытых.
    expect(isOpenStatus('backlog')).toBe(true)
    expect(isFinalStatus('backlog')).toBe(false)
    expect(STATUS_LABEL.backlog).toBe('В бэклоге')
  })
})

describe('тексты и форматы', () => {
  it('у каждого кода — человеческий текст, неизвестный — общий', () => {
    for (const c of ['empty', 'too_long', 'rate_limited', 'forbidden', 'not_deployed', 'offline', 'shot_failed']) {
      expect(feedbackErrorText(c)).not.toBe(feedbackErrorText('???'))
    }
    expect(feedbackErrorText('rate_limited')).toMatch(/через час/)
  })
  it('дата и строка контекста', () => {
    expect(fmtFeedbackDate('2026-10-05T14:32:00')).toBe('05.10 14:32')
    expect(fmtFeedbackDate('nope')).toBe('')
    expect(contextLine({ version: '6.11.0', device: 'iPhone', standalone: false, screen: 'Лента', online: false }))
      .toBe('v6.11.0 · iPhone · браузер · открыто с: Лента · офлайн')
    expect(contextLine({ device: { x: 1 } })).toBe('')
    // v8.0.1: пересланное в бота
    expect(contextLine({ source: 'telegram', tg_from: 'Маша', tg_user_id: 1 })).toBe('из Telegram (Маша)')
    expect(contextLine({ source: 'telegram' })).toBe('из Telegram')
  })
})

describe('describeDevice — замороженный userAgent iOS 26 (v6.11.1)', () => {
  // Safari 26 пишет в UA «OS 18_6/18_7», а в PWA нет и токена Version/.
  const PWA_26 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
  const SAFARI_26 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
  it('PWA на движке 26+ → «iOS 26+», а не замороженные 18.7', () => {
    expect(describeDevice(PWA_26, { modernWebKit: true })).toBe('iPhone · iOS 26+')
  })
  it('настоящая iOS 18.7 (старый движок) остается 18.7', () => {
    expect(describeDevice(PWA_26, { modernWebKit: false })).toBe('iPhone · iOS 18.7')
    expect(describeDevice(PWA_26)).toBe('iPhone · iOS 18.7')
  })
  it('в Safari берем настоящую версию из Version/26.x', () => {
    expect(describeDevice(SAFARI_26)).toBe('iPhone · iOS 26.0')
  })
  it('старые iOS не трогаем', () => {
    expect(describeDevice(IPHONE, { modernWebKit: true })).toBe('iPhone · iOS 17.5')
  })
})

describe('isWebKit26Plus', () => {
  it('по поддержке CSS: якоря или анимации по прокрутке', () => {
    expect(isWebKit26Plus({ supports: (q) => q.startsWith('anchor-name') })).toBe(true)
    expect(isWebKit26Plus({ supports: (q) => q.startsWith('animation-timeline') })).toBe(true)
    expect(isWebKit26Plus({ supports: () => false })).toBe(false)
    expect(isWebKit26Plus(undefined)).toBe(false)
    expect(isWebKit26Plus({ supports: () => { throw new Error('x') } })).toBe(false)
  })
})

describe('ответ из Telegram и переоткрытие (v6.12.0)', () => {
  const R = { status: 'resolved', reply: null, reply_photos: 0, replied_at: '2026-10-05T12:00:00Z', reply_seen_at: null }
  it('hasReply: текст или фото; фото-ответ тоже «непрочитан»', () => {
    expect(hasReply(R)).toBe(false)
    expect(hasReply({ ...R, reply_photos: 1 })).toBe(true)
    expect(hasReply({ ...R, reply: 'да' })).toBe(true)
    expect(hasUnreadReply({ ...R, reply_photos: 2 })).toBe(true)
    expect(hasUnreadReply(R)).toBe(false)
  })
  it('canReopen: только решенное/отклоненное и до лимита', () => {
    expect(canReopen(R)).toBe(true)
    expect(canReopen({ ...R, status: 'declined', reopen_count: 2 })).toBe(true)
    expect(canReopen({ ...R, reopen_count: REOPEN_LIMIT })).toBe(false)
    expect(canReopen({ ...R, status: 'in_progress' })).toBe(false)
    expect(canReopen(null)).toBe(false)
  })
  it('reopenProblem и isStaleReply', () => {
    expect(reopenProblem('  ')).toBe('empty')
    expect(reopenProblem('x'.repeat(REOPEN_MAX + 1))).toBe('too_long')
    expect(reopenProblem('не помогло')).toBeNull()
    expect(isStaleReply({ replied_at: '2026-10-05T12:00:00Z', reopened_at: '2026-10-05T13:00:00Z' })).toBe(true)
    expect(isStaleReply({ replied_at: '2026-10-05T14:00:00Z', reopened_at: '2026-10-05T13:00:00Z' })).toBe(false)
    expect(isStaleReply({ replied_at: '2026-10-05T14:00:00Z' })).toBe(false)
    expect(feedbackErrorText('reopen_limit')).toContain('3 раза')
  })
})

describe('дополнение к открытому (v8.6.0)', () => {
  it('canAppend: только новое/в работе и до 5 дополнений', async () => {
    const { canAppend, APPEND_LIMIT } = await import('./feedback.js')
    expect(canAppend({ status: 'new' })).toBe(true)
    expect(canAppend({ status: 'in_progress', additions: [{}, {}] })).toBe(true)
    expect(canAppend({ status: 'new', additions: Array(APPEND_LIMIT).fill({}) })).toBe(false)
    expect(canAppend({ status: 'resolved' })).toBe(false)
    expect(canAppend(null)).toBe(false)
  })
  it('appendProblem и тексты ошибок сервера', async () => {
    const { appendProblem, APPEND_MAX } = await import('./feedback.js')
    expect(appendProblem(' ')).toBe('empty')
    expect(appendProblem('x'.repeat(APPEND_MAX + 1))).toBe('too_long')
    expect(appendProblem('и еще')).toBeNull()
    expect(feedbackErrorText('append_limit')).toContain('5 дополнений')
    expect(feedbackErrorText('not_open')).toMatch(/открой его снова/)
  })
})

describe('myFeedbackTab', () => {
  const o = { id: 'o', status: 'new' }
  const c = { id: 'c', status: 'resolved', reply: 'ок', replied_at: '2026-10-05T12:00:00Z', reply_seen_at: '2026-10-05T13:00:00Z' }
  it('пуш → вкладка обращения; новый ответ → его вкладка; иначе открытые, если есть', () => {
    expect(myFeedbackTab([o, c], 'c')).toBe('closed')
    expect(myFeedbackTab([o, { ...c, reply_seen_at: null }])).toBe('closed')
    expect(myFeedbackTab([o, c])).toBe('open')
    expect(myFeedbackTab([c])).toBe('closed')
    expect(myFeedbackTab([])).toBe('open')
  })
})

describe('видео к обращению (fb_1c5fab9c)', () => {
  const f = (name, type, size = 1) => ({ name, type, size })
  it('MP4/MOV до 50 МБ; другое видео — формат; не картинка и не видео — нельзя', () => {
    expect([videoExt(f('a.mp4', 'video/mp4')), videoExt(f('IMG.MOV', 'video/quicktime')), videoExt(f('x.mov', ''))]).toEqual(['mp4', 'mov', 'mov'])
    expect(attachmentProblem(f('a.jpg', 'image/jpeg'))).toBe(null)
    expect(attachmentProblem(f('a.mp4', 'video/mp4', 20 * 1024 * 1024))).toBe(null)
    // fb_2bd2021d: запись экрана 12,9 МБ в «Фото» iPhone отдал файлом больше 20 МБ — теперь проходит.
    expect(attachmentProblem(f('ScreenRecording.mov', 'video/quicktime', 27 * 1024 * 1024))).toBe(null)
    expect(attachmentProblem(f('a.mp4', 'video/mp4', 50 * 1024 * 1024))).toBe(null)
    expect(attachmentProblemText(f('a.mp4', 'video/mp4', 50 * 1024 * 1024))).toBe('')
    // fb_59c95046: кадр видео на iPhone и подпись размера в форме.
    expect([videoPosterSrc('blob:x'), videoPosterSrc('')]).toEqual(['blob:x#t=0.1', ''])
    expect([fmtFileSize(2317943), fmtFileSize(1000), fmtFileSize(0)]).toEqual(['2.3 МБ', '0.1 МБ', ''])
    expect(feedbackErrorText('bad_request')).toMatch(/вложение/)
    expect(attachmentProblem(f('a.mp4', 'video/mp4', 50 * 1024 * 1024 + 1))).toBe('video_too_big')
    // В отказе — настоящий размер файла от телефона, а не только порог.
    expect(attachmentProblemText(f('a.mov', 'video/quicktime', 61.3 * 1024 * 1024))).toMatch(/^Видео 64.3 МБ — больше 50 МБ\./) // десятичные МБ, как в «Фото»
    expect(attachmentProblemText(f('a.webm', 'video/webm'))).toBe(feedbackErrorText('video_format'))
    expect(attachmentProblem(f('a.webm', 'video/webm'))).toBe('video_format')
    expect(attachmentProblem(f('a.pdf', 'application/pdf'))).toBe('shot_format')
  })
  it('тип по первым байтам', () => {
    const box = (brand) => new Uint8Array([0, 0, 0, 20, ...new TextEncoder().encode('ftyp' + brand)])
    expect(sniffMediaType(box('isom'))).toBe('video/mp4')
    expect(sniffMediaType(box('qt  '))).toBe('video/quicktime')
    expect(sniffMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffMediaType(new Uint8Array([1, 2]))).toBe(null)
  })
})

// fb_37f0c1a8: вложение, приложенное с дополнением, показывается под ним, а не общим блоком.
describe('groupAttachments', () => {
  const adds = [{ n: 1, created_at: '2026-10-23T08:17:35Z' }, { n: 2, created_at: '2026-10-23T09:00:00Z' }]
  it('без времени — к обращению; со временем — к своему дополнению', () => {
    expect(groupAttachments(3, { 1: '2026-10-23T08:18:10Z', 2: '2026-10-23T09:00:20Z' }, adds))
      .toEqual({ base: [0], byAddition: { 1: [1], 2: [2] }, later: [] })
  })
  it('дополнения нет рядом (файлы без текста) — «добавлено позже»; часы чуть впереди — терпим', () => {
    expect(groupAttachments(3, { 1: '2026-10-23T08:40:00Z', 2: '2026-10-23T08:17:33Z' }, adds))
      .toEqual({ base: [0], byAddition: { 1: [2] }, later: [1] })
  })
  it('нет времени и дополнений — все к обращению; мусор не ломает', () => {
    expect(groupAttachments(2)).toEqual({ base: [0, 1], byAddition: {}, later: [] })
    expect(groupAttachments(1, { 0: 'не дата' }, [{ n: 1, created_at: null }])).toEqual({ base: [0], byAddition: {}, later: [] })
    expect(groupAttachments(undefined, null, null)).toEqual({ base: [], byAddition: {}, later: [] })
  })
})

it('laterLabel — когда приложены, без даты — «отдельно» (fb_9acbbfc6)', () => {
  expect(laterLabel({ 2: '2026-10-23T09:02:00Z' }, [2])).toMatch(/^Приложенное 23\.10/)
  expect(laterLabel(null, [])).toBe('Приложенное отдельно')
})

it('groupAttachments: приложенное вместе с исходным сообщением — к обращению (fb_d4103a75)', () => {
  const created = '2026-10-23T09:04:47Z'
  expect(groupAttachments(2, { 0: '2026-10-23T09:04:48Z', 1: '2026-10-23T10:30:00Z' }, [], created))
    .toEqual({ base: [0], byAddition: {}, later: [1] })
})
