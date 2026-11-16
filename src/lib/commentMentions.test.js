import { describe, expect, it } from 'vitest'
import { mentionAt, mentionCandidates, mentionParts } from './commentMentions.js'

describe('упоминания в комментариях', () => {
  it('ищет имя перед курсором и пропускает адреса почты', () => {
    expect(mentionAt('Эй, @Анна М, привет', 11)).toEqual({ start: 4, end: 11, query: 'анна м' })
    expect(mentionAt('anna@mail', 9)).toBeNull()
    expect(mentionAt('@А\n', 3)).toBeNull()
  })

  it('оставляет доступных участников с различимыми именами', () => {
    const person = (user_id, name, known = true) => ({ user_id, name, known })
    expect(mentionCandidates([
      person('1', 'Дима'), person('2', 'дима'), person('3', 'Аня', false),
      person('4', ' @Аня '), person('5', ''), person(null, 'Саша'), person('6', ' Олег '),
    ], person('6', 'Олег'))).toEqual([{ id: '6', name: 'Олег' }])
  })

  it('поддерживает пробелы, знаки и регистр имени, сохраняет обычный текст', () => {
    const people = [{ id: '1', name: 'Анна' }, { id: '2', name: 'Анна (Т.)' }]
    expect(mentionParts('Почта a@Анна, привет @АННА (Т.)! @Аннабель', people)).toEqual([
      'Почта a@Анна, привет ', { ...people[1], text: '@АННА (Т.)' }, '! @Аннабель',
    ])
    expect(mentionParts('обычный текст', people)).toEqual(['обычный текст'])
    expect(mentionParts('@Анна', [])).toEqual(['@Анна'])
  })
})
