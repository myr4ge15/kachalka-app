// Справочник техники (v8.0.0): целостность контента и привязка к каталогу.
// Контент — поставляемые данные, поэтому длины списков, мышцы и кадры держит тест:
// опечатка в слаге мышцы или забытый файл кадра иначе всплыли бы только у друзей.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { TECHNIQUE_INDEX } from '../content/techniqueIndex.js'
import { TECHNIQUE, EVERKINETIC } from '../content/technique.js'
import { isKnownSub } from './muscles.js'
import { techniqueSlugFor, techniqueFrameUrl } from './technique.js'

const publicFile = (f) => new URL(`../../public/technique/${f}`, import.meta.url)

describe('справочник техники — целостность', () => {
  it('индекс и тексты совпадают по слагам, слаги и названия уникальны', () => {
    const slugs = TECHNIQUE_INDEX.map((x) => x.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(Object.keys(TECHNIQUE).sort()).toEqual([...slugs].sort())
    const names = TECHNIQUE_INDEX.flatMap((x) => x.names)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) {
      expect(n).toBe(n.trim())
      expect(n).not.toMatch(/ё/) // каталог — через «е» (v7.4.1)
    }
  })

  it('у каждой карточки: 3–5 шагов, 2–3 подсказки, 2–3 ошибки, оборудование', () => {
    for (const [slug, c] of Object.entries(TECHNIQUE)) {
      expect(c.steps.length, slug).toBeGreaterThanOrEqual(3)
      expect(c.steps.length, slug).toBeLessThanOrEqual(5)
      expect(c.tips.length, slug).toBeGreaterThanOrEqual(2)
      expect(c.tips.length, slug).toBeLessThanOrEqual(3)
      expect(c.mistakes.length, slug).toBeGreaterThanOrEqual(2)
      expect(c.mistakes.length, slug).toBeLessThanOrEqual(3)
      expect(c.equipment, slug).toBeTruthy()
    }
  })

  it('мышцы — из таксономии lib/muscles.js, основная не дублируется во вспомогательных', () => {
    for (const [slug, c] of Object.entries(TECHNIQUE)) {
      expect(c.primary.length, slug).toBeGreaterThan(0)
      for (const m of [...c.primary, ...c.secondary]) expect(isKnownSub(m), `${slug}: ${m}`).toBe(true)
      for (const m of c.primary) expect(c.secondary, slug).not.toContain(m)
    }
  })

  it('кадры: ровно два, файлы лежат в public/technique и описаны в SOURCES.md', () => {
    const sources = readFileSync(publicFile('SOURCES.md'), 'utf-8')
    let withFrames = 0
    for (const [slug, c] of Object.entries(TECHNIQUE)) {
      if (c.frames.length === 0) continue
      withFrames++
      expect(c.frames, slug).toHaveLength(2)
      for (const f of c.frames) {
        expect(existsSync(publicFile(f.file)), f.file).toBe(true)
        expect(f.caption, f.file).toBeTruthy()
        // Файл — без скриптов и внешних ссылок: SVG показывается как <img>, но лишнего не тащим.
        expect(readFileSync(publicFile(f.file), 'utf-8')).not.toMatch(/<script|href=|<image/)
      }
      expect(sources, slug).toContain(`${slug}-1/2`)
    }
    expect(withFrames).toBeGreaterThan(0)
    expect(sources).toContain(EVERKINETIC.license)
  })
})

describe('techniqueSlugFor — привязка к упражнению каталога', () => {
  it('общее упражнение — по точному названию', () => {
    expect(techniqueSlugFor({ name: 'Жим лежа со штангой', is_custom: false })).toBe('bench-press')
    expect(techniqueSlugFor({ name: '  Жим ногами ' })).toBe('leg-press')
  })

  it('свое, скрытое и похожее по названию — без подсказки', () => {
    expect(techniqueSlugFor({ name: 'Жим лежа со штангой', is_custom: true })).toBeNull()
    expect(techniqueSlugFor({ name: 'Жим лежа со штангой', is_hidden: true })).toBeNull()
    // Другой вариант упражнения — не та же демонстрация (нечеткого сравнения нет).
    expect(techniqueSlugFor({ name: 'Жим гантелей сидя' })).toBeNull()
    expect(techniqueSlugFor({ name: 'Ягодичный мостик на полу' })).toBeNull()
    // Сгибание ног — подсказки только у «лежа»/«сидя» (до разделения упражнения — без нее).
    expect(techniqueSlugFor({ name: 'Сгибание ног в тренажере' })).toBeNull()
    expect(techniqueSlugFor({ name: 'Сгибание ног лежа в тренажере' })).toBe('lying-leg-curl')
    // Переименование (v8.3.0): подсказка и по старому, и по новому названию.
    expect(techniqueSlugFor({ name: 'Подъем рук перед собой стоя' })).toBe('front-raise')
    expect(techniqueSlugFor({ name: 'Подъем гантелей перед собой' })).toBe('front-raise')
    expect(techniqueSlugFor({ name: 'жим лежа со штангой' })).toBeNull()
    expect(techniqueSlugFor(null)).toBeNull()
  })

  it('адрес кадра учитывает base сборки', () => {
    expect(techniqueFrameUrl('a-1.svg', '/kachalka-app/')).toBe('/kachalka-app/technique/a-1.svg')
    expect(techniqueFrameUrl('a-1.svg', '/')).toBe('/technique/a-1.svg')
    expect(techniqueFrameUrl('a-1.svg', '/x')).toBe('/x/technique/a-1.svg')
  })
})
