import { describe, it, expect } from 'vitest'
import {
  daySubTags,
  dayTags,
  tagSlug,
  groupAccusative,
  matchesGroup,
} from './dayTags.js'

describe('dayTags', () => {
  it('уникальные группы в каноническом порядке', () => {
    const entries = [
      { exercise: { muscle_group: 'спина' } },
      { exercise: { muscle_group: 'грудь' } },
      { exercise: { muscle_group: 'спина' } },
    ]
    expect(dayTags(entries)).toEqual(['грудь', 'спина'])
  })

  it('поддерживает оба формата записи', () => {
    expect(dayTags([{ muscle_group: 'ноги' }])).toEqual(['ноги'])
  })

  it('кардио одновременно проходит фильтр и остаётся видимой меткой карточки', () => {
    const entries = [{
      exercise: {
        muscle_group: 'кардио',
        submuscle: 'cardio',
      },
    }]

    expect(matchesGroup(entries, 'кардио')).toBe(true)
    expect(daySubTags(entries)).toContain('cardio')
  })
})

describe('groupAccusative', () => {
  it('«спина» → «спину»', () => {
    expect(groupAccusative('спина')).toBe('спину')
  })
  it('остальные группы совпадают с именительным', () => {
    for (const g of ['грудь', 'ноги', 'плечи', 'бицепс', 'трицепс', 'пресс']) {
      expect(groupAccusative(g)).toBe(g)
    }
  })
  it('неизвестная группа и пустое — без изменений', () => {
    expect(groupAccusative('предплечья')).toBe('предплечья')
    expect(groupAccusative(null)).toBe(null)
    expect(groupAccusative('')).toBe('')
  })
})

describe('tagSlug', () => {
  it('известная группа → slug, неизвестная → other', () => {
    expect(tagSlug('спина')).toBe('back')
    expect(tagSlug('нечто')).toBe('other')
  })
})
