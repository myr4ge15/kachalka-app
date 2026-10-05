import { describe, expect, it } from 'vitest'
import {
  bodyProblem, buildContext, cleanBody, contextLine, describeDevice, feedbackErrorText, isWebKit26Plus,
  fmtFeedbackDate, hasUnreadReply, isOpenStatus, openCount, unreadReplies, FEEDBACK_MAX,
  canReopen, hasReply, isStaleReply, reopenProblem, REOPEN_LIMIT, REOPEN_MAX,
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
