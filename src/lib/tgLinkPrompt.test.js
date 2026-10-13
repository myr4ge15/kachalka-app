import { describe, expect, it } from 'vitest'
import { laterLabel, shouldShowTgPrompt, SNOOZE_MS, tgLinkDone, tgPromptKind } from './tgLinkPrompt.js'

const BOT = { dedicated: true }

describe('tgPromptKind', () => {
  it('у сброса PIN еще нет своего бота — молчим', () => {
    expect(tgPromptKind({ tgLinked: false }, { dedicated: false })).toBeNull()
    expect(tgPromptKind({ tgLinked: true, tgBot: 'notifier' }, null)).toBeNull()
  })
  it('не привязан — «привяжи»', () => {
    expect(tgPromptKind({ tgLinked: false, tgBot: null }, BOT)).toBe('link')
  })
  it('привязан к старому боту — «перепривяжи», к новому — ничего', () => {
    expect(tgPromptKind({ tgLinked: true, tgBot: 'notifier' }, BOT)).toBe('relink')
    expect(tgPromptKind({ tgLinked: true, tgBot: 'pin' }, BOT)).toBeNull()
  })
  it('сервер не сообщает бота (нет tg-bots-split.sql) — про перепривязку молчим', () => {
    expect(tgPromptKind({ tgLinked: true, tgBot: null }, BOT)).toBeNull()
    expect(tgPromptKind(null, BOT)).toBeNull()
  })
})

describe('shouldShowTgPrompt', () => {
  const now = 1_800_000_000_000
  it('перепривязка — каждый запуск, «Позже» ее не прячет', () => {
    expect(shouldShowTgPrompt('relink', now + SNOOZE_MS, now)).toBe(true)
  })
  it('привязка — до конца паузы «Позже» не показываем', () => {
    expect(shouldShowTgPrompt('link', null, now)).toBe(true)
    expect(shouldShowTgPrompt('link', 'мусор', now)).toBe(true)
    expect(shouldShowTgPrompt('link', now + 1, now)).toBe(false)
    expect(shouldShowTgPrompt('link', String(now), now)).toBe(true)
  })
  it('ничего показывать — ничего', () => {
    expect(shouldShowTgPrompt(null, null, now)).toBe(false)
  })
})

describe('tgLinkDone / laterLabel', () => {
  it('привязка в новом боте — готово; к старому — нет', () => {
    expect(tgLinkDone({ tgLinked: true, tgBot: 'pin' })).toBe(true)
    expect(tgLinkDone({ tgLinked: true, tgBot: 'notifier' })).toBe(false)
    expect(tgLinkDone({ tgLinked: false })).toBe(false)
  })
  it('обратный отсчет «Позже»', () => {
    expect(laterLabel(3000)).toBe('Позже (3)')
    expect(laterLabel(2001)).toBe('Позже (3)')
    expect(laterLabel(999)).toBe('Позже (1)')
    expect(laterLabel(0)).toBe('Позже')
    expect(laterLabel(-5)).toBe('Позже')
  })
})
