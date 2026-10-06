import { describe, expect, it } from 'vitest'
import { inlineParts, parseMarkdown } from './miniMarkdown.js'
import quickStart from '../../docs/quick-start.md?raw'

describe('parseMarkdown', () => {
  it('заголовки, абзацы (с переносами строк), списки, цитата, черта', () => {
    const md = '# Т\r\n\nстрока 1\nстрока 2\n\n## Раздел\n- a\n- b\n\n1. x\n2. y\n\n> важно\n\n---\n'
    expect(parseMarkdown(md)).toEqual([
      { type: 'h', level: 1, text: 'Т' },
      { type: 'p', text: 'строка 1 строка 2' },
      { type: 'h', level: 2, text: 'Раздел' },
      { type: 'ul', items: ['a', 'b'] },
      { type: 'ol', items: ['x', 'y'] },
      { type: 'quote', text: 'важно' },
      { type: 'hr' },
    ])
  })

  it('список сразу после абзаца — отдельный блок', () => {
    expect(parseMarkdown('Шаги:\n1. раз\n2. два').map((b) => b.type)).toEqual(['p', 'ol'])
  })

  it('docs/quick-start.md разбирается целиком: есть все 15 разделов и итог', () => {
    const h2 = parseMarkdown(quickStart).filter((b) => b.type === 'h' && b.level === 2)
    expect(h2).toHaveLength(16)
    expect(h2.at(-1).text).toBe('Если совсем коротко')
  })
})

describe('inlineParts', () => {
  it('выделяет **жирный**', () => {
    expect(inlineParts('На **Главной** нажми **«+»**')).toEqual([
      { text: 'На ' }, { text: 'Главной', bold: true }, { text: ' нажми ' }, { text: '«+»', bold: true },
    ].map((p) => ({ bold: false, ...p })))
  })
  it('непарная звездочка — просто текст', () => {
    expect(inlineParts('a ** b')).toEqual([{ text: 'a ** b' }])
  })
})
