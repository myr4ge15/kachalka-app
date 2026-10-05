import { describe, expect, it } from 'vitest'
import {
  bodyProblem, buildContext, cleanBody, contextLine, describeDevice, feedbackErrorText,
  fmtFeedbackDate, hasUnreadReply, isOpenStatus, openCount, unreadReplies, FEEDBACK_MAX,
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
      .toBe('v6.11.0 · iPhone · браузер · экран: Лента · офлайн')
    expect(contextLine({ device: { x: 1 } })).toBe('')
  })
})
