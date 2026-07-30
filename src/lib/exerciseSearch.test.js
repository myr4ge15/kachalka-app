// Регрессия на пять реальных промахов старого `name.includes(query)` в пикере:
// ё/е, порядок слов, префикс слова, опечатка, запрос мышцей вместо названия.
import { describe, it, expect } from 'vitest'
import { searchExercises } from './exerciseSearch.js'

const CATALOG = [
  { id: 'bench', name: 'Жим лёжа', muscle_group: 'грудь', submuscle: 'chest_middle', secondary: ['triceps', 'delt_front'] },
  { id: 'bench-narrow', name: 'Жим лёжа узким хватом', muscle_group: 'грудь', submuscle: 'chest_middle', secondary: ['triceps'] },
  { id: 'pulldown', name: 'Тяга верхнего блока', muscle_group: 'спина', submuscle: 'lats', secondary: ['biceps'] },
  { id: 'press-seated', name: 'Жим гантелей сидя', muscle_group: 'плечи', submuscle: 'delt_front', secondary: ['triceps'] },
  { id: 'lat-raise', name: 'Разведение в стороны', muscle_group: 'плечи', submuscle: 'delt_side', secondary: [] },
  { id: 'squat', name: 'Приседания со штангой', muscle_group: 'ноги', submuscle: 'quads', secondary: ['glute_max'] },
  { id: 'legpress', name: 'Жим ногами', muscle_group: 'ноги', submuscle: 'quads', secondary: [] },
]

const ids = (list) => list.map((e) => e.id)

describe('searchExercises — совпадения по названию', () => {
  it('игнорирует разницу ё/е', () => {
    expect(ids(searchExercises('жим лежа', CATALOG).byName)).toContain('bench')
  })

  it('не зависит от порядка слов', () => {
    expect(ids(searchExercises('лежа жим', CATALOG).byName)).toContain('bench')
  })

  it('находит по префиксам слов в любом месте названия', () => {
    expect(ids(searchExercises('верх блок', CATALOG).byName)).toEqual(['pulldown'])
  })

  it('прощает опечатку', () => {
    expect(ids(searchExercises('жим лжа', CATALOG).byName)).toContain('bench')
  })

  it('короткое название ставит выше длинного при равном совпадении', () => {
    expect(ids(searchExercises('жим лежа', CATALOG).byName)).toEqual(['bench', 'bench-narrow'])
  })

  it('точное совпадение идёт первым, даже если длиннее прочих совпадений', () => {
    const found = ids(searchExercises('жим ногами', CATALOG).byName)
    expect(found[0]).toBe('legpress')
  })

  it('один токен названия не закрывает два одинаковых токена запроса', () => {
    expect(ids(searchExercises('жим жим', CATALOG).byName)).toEqual([])
  })

  it('пустой запрос отдаёт справочник как есть', () => {
    const { byName, byMuscle } = searchExercises('   ', CATALOG)
    expect(byName).toBe(CATALOG)
    expect(byMuscle).toEqual([])
  })
})

describe('searchExercises — совпадения по мышцам', () => {
  it('находит всю группу по началу её названия', () => {
    const { byName, byMuscle } = searchExercises('плеч', CATALOG)
    expect(byName).toEqual([])
    expect(ids(byMuscle)).toEqual(['press-seated', 'lat-raise'])
  })

  it('находит по подписи основной подмышцы', () => {
    expect(ids(searchExercises('дельт', CATALOG).byMuscle)).toContain('lat-raise')
  })

  it('находит по вторичной мышце', () => {
    expect(ids(searchExercises('трицепс', CATALOG).byMuscle)).toContain('bench')
  })

  it('не дублирует упражнение между списками', () => {
    const { byName, byMuscle } = searchExercises('жим', CATALOG)
    expect(ids(byName)).toEqual(['bench', 'legpress', 'press-seated', 'bench-narrow'])
    for (const id of ids(byName)) expect(ids(byMuscle)).not.toContain(id)
  })

  it('запрос названием группы отдаёт всю группу, включая словоформы', () => {
    // «ноги» ≠ префикс «ногами» (русская словоформа, стемминг не делаем), но
    // группа у «Жима ногами» — «ноги», поэтому упражнение всё равно находится.
    const { byName, byMuscle } = searchExercises('ноги', CATALOG)
    expect(byName).toEqual([])
    expect(ids(byMuscle)).toEqual(['squat', 'legpress'])
  })

  it('переносит упражнение из мышц в названия, если совпало и то и то', () => {
    const { byName, byMuscle } = searchExercises('приседания', CATALOG)
    expect(ids(byName)).toEqual(['squat'])
    expect(byMuscle).toEqual([])
  })
})

describe('searchExercises — защита от шума', () => {
  it('на коротком запросе не включает мышцы и опечатки', () => {
    const { byName, byMuscle } = searchExercises('но', CATALOG)
    expect(byMuscle).toEqual([])
    // Только честные подстроки/префиксы, без фаззи-догадок.
    expect(ids(byName)).toEqual(['legpress'])
  })

  it('не выдаёт мусор на бессмысленный запрос', () => {
    const { byName, byMuscle } = searchExercises('квкцужб', CATALOG)
    expect(byName).toEqual([])
    expect(byMuscle).toEqual([])
  })

  it('терпит упражнение без подмышц и вторичных', () => {
    const bare = [{ id: 'x', name: 'Своё упражнение', muscle_group: 'грудь' }]
    expect(ids(searchExercises('грудь', bare).byMuscle)).toEqual(['x'])
  })
})
