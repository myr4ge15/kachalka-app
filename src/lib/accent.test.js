// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ACCENTS, ACCENT_KEY, DEFAULT_ACCENT, DEFAULT_HUE, CUSTOM, CUSTOM_PROPS,
  normHue, isRedZone, customTokens, parseAccent, serializeAccent, applyAccent, loadAccent, saveAccent,
} from './accent.js'

describe('accent: справочник', () => {
  it('семь готовых акцентов, по умолчанию — вольт', () => {
    expect(ACCENTS.map((a) => a.id)).toEqual(['volt', 'teal', 'red', 'yellow', 'pink', 'violet', 'peach'])
    expect(DEFAULT_ACCENT).toBe('volt')
    expect(new Set(ACCENTS.map((a) => a.id)).size).toBe(ACCENTS.length)
  })
})

describe('accent: оттенок', () => {
  it('normHue сворачивает в 0–359 и отбрасывает мусор', () => {
    expect(normHue(0)).toBe(0)
    expect(normHue(360)).toBe(0)
    expect(normHue(-10)).toBe(350)
    expect(normHue(725)).toBe(5)
    expect(normHue('200')).toBe(200)
    expect(normHue(12.6)).toBe(13)
    expect(normHue('abc')).toBe(DEFAULT_HUE)
    expect(normHue(undefined)).toBe(DEFAULT_HUE)
  })
  it('красная зона — 0–35 и 335–359', () => {
    expect(isRedZone(0)).toBe(true)
    expect(isRedZone(35)).toBe(true)
    expect(isRedZone(36)).toBe(false)
    expect(isRedZone(200)).toBe(false)
    expect(isRedZone(334)).toBe(false)
    expect(isRedZone(335)).toBe(true)
  })
  it('customTokens: фиксированные светлота и насыщенность, меняется только оттенок', () => {
    const t = customTokens(150)
    expect(Object.keys(t).sort()).toEqual([...CUSTOM_PROPS].sort())
    expect(t['--acc']).toBe('oklch(0.79 0.19 150)')
    expect(t['--on-acc']).toBe('oklch(0.2 0.04 150)')
    expect(customTokens(510)['--acc']).toBe('oklch(0.79 0.19 150)')
  })
})

describe('accent: хранение', () => {
  it('parseAccent принимает готовый и свой, мусор → по умолчанию', () => {
    expect(parseAccent('{"id":"teal","hue":10}')).toEqual({ id: 'teal', hue: 10 })
    expect(parseAccent('{"id":"custom","hue":400}')).toEqual({ id: CUSTOM, hue: 40 })
    expect(parseAccent('{"id":"orange"}')).toEqual({ id: DEFAULT_ACCENT, hue: DEFAULT_HUE })
    expect(parseAccent('not json')).toEqual({ id: DEFAULT_ACCENT, hue: DEFAULT_HUE })
    expect(parseAccent('')).toEqual({ id: DEFAULT_ACCENT, hue: DEFAULT_HUE })
    expect(parseAccent(null)).toEqual({ id: DEFAULT_ACCENT, hue: DEFAULT_HUE })
    expect(parseAccent('42')).toEqual({ id: DEFAULT_ACCENT, hue: DEFAULT_HUE })
  })
  it('serializeAccent ↔ parseAccent', () => {
    const s = serializeAccent({ id: 'custom', hue: -30 })
    expect(JSON.parse(s)).toEqual({ id: 'custom', hue: 330 })
    expect(parseAccent(serializeAccent({ id: 'peach' }))).toEqual({ id: 'peach', hue: DEFAULT_HUE })
  })
  it('load/save переживают недоступное хранилище', () => {
    const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
    expect(loadAccent(broken)).toEqual({ id: DEFAULT_ACCENT, hue: DEFAULT_HUE })
    expect(saveAccent(broken, { id: 'red' })).toBe(false)
    const mem = new Map()
    const ok = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) }
    expect(saveAccent(ok, { id: 'red' })).toBe(true)
    expect(loadAccent(ok)).toEqual({ id: 'red', hue: DEFAULT_HUE })
  })
})

describe('accent: применение', () => {
  let el
  beforeEach(() => { el = document.createElement('div') })

  it('готовый акцент — только data-accent, инлайн снят', () => {
    applyAccent(el, { id: CUSTOM, hue: 100 })
    applyAccent(el, { id: 'violet' })
    expect(el.dataset.accent).toBe('violet')
    for (const k of CUSTOM_PROPS) expect(el.style.getPropertyValue(k)).toBe('')
  })
  it('свой оттенок — data-accent="custom" и инлайн-переменные', () => {
    applyAccent(el, { id: CUSTOM, hue: 290 })
    expect(el.dataset.accent).toBe('custom')
    expect(el.style.getPropertyValue('--acc')).toBe('oklch(0.79 0.19 290)')
  })
})

describe('public/accent-boot.js совпадает с lib/accent.js', () => {
  const src = readFileSync(resolve(__dirname, '../../public/accent-boot.js'), 'utf8')
  const run = (stored) => {
    const root = document.documentElement
    root.removeAttribute('data-accent')
    for (const k of CUSTOM_PROPS) root.style.removeProperty(k)
    if (stored == null) localStorage.removeItem(ACCENT_KEY)
    else localStorage.setItem(ACCENT_KEY, stored)
    new Function(src)()
    return {
      id: root.getAttribute('data-accent'),
      props: Object.fromEntries(CUSTOM_PROPS.map((k) => [k, root.style.getPropertyValue(k)])),
    }
  }
  const expected = (stored) => {
    const el = document.createElement('div')
    applyAccent(el, parseAccent(stored ?? ''))
    return {
      id: el.dataset.accent,
      props: Object.fromEntries(CUSTOM_PROPS.map((k) => [k, el.style.getPropertyValue(k)])),
    }
  }
  for (const stored of [null, 'мусор', '{"id":"teal"}', '{"id":"custom","hue":-45}', '{"id":"custom","hue":"12.4"}', '{"id":"nope","hue":5}']) {
    it(`одинаково для ${stored}`, () => {
      expect(run(stored)).toEqual(expected(stored))
    })
  }
})

describe('accent: для синка', () => {
  it('hasStoredAccent отличает явный выбор от дефолта', async () => {
    const { hasStoredAccent } = await import('./accent.js')
    expect(hasStoredAccent({ getItem: () => null })).toBe(false)
    expect(hasStoredAccent({ getItem: () => '{"id":"teal"}' })).toBe(true)
    expect(hasStoredAccent({ getItem: () => { throw new Error('x') } })).toBe(false)
  })
  it('sameAccent: у готовых важен id, у своего — ещё и оттенок', async () => {
    const { sameAccent } = await import('./accent.js')
    expect(sameAccent({ id: 'teal', hue: 1 }, { id: 'teal', hue: 99 })).toBe(true)
    expect(sameAccent({ id: 'custom', hue: 1 }, { id: 'custom', hue: 99 })).toBe(false)
    expect(sameAccent({ id: 'teal' }, { id: 'peach' })).toBe(false)
  })
})
