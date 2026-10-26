import { describe, it, expect } from 'vitest'
import {
  cmpVersion, pendingWhatsNew, mergeForSheet, hasUnopened, updateHeadline, versionJson, fmtWhatsNewDate, readMark, writeMark, ofEpoch, VERSION_EPOCH,
} from './whatsNew.js'
import { WHATS_NEW } from '../content/whatsNew.js'

const E = [
  { version: '6.5.0', date: '2026-10-10', main: [{ e: 'a', t: 'A1' }, { e: 'a', t: 'A2' }], minor: [{ e: 'm', t: 'Am' }] },
  { version: '6.4.0', date: '2026-10-01', main: [{ e: 'b', t: 'B1' }, { e: 'b', t: 'B2' }, { e: 'b', t: 'B3' }], minor: [{ e: 'm', t: 'Bm' }] },
  { version: '6.3.4', date: '2026-09-30', main: [{ e: 'c', t: 'C1' }], minor: [] },
]

describe('cmpVersion', () => {
  it('сравнивает по числам', () => {
    expect(cmpVersion('6.10.0', '6.9.3')).toBe(1)
    expect(cmpVersion('6.4.0', '6.4.0')).toBe(0)
    expect(cmpVersion('5.14.1', '6.0.0')).toBe(-1)
  })
})

describe('pendingWhatsNew', () => {
  it('новое устройство: молча запоминаем текущую версию', () => {
    expect(pendingWhatsNew(E, null, '6.5.0')).toEqual({ show: [], markSeen: '6.5.0' })
  })
  it('устройство, где уже входили, но отметки нет — только свежая запись', () => {
    expect(pendingWhatsNew(E, null, '6.4.0', { knownDevice: true }).show.map((e) => e.version)).toEqual(['6.4.0'])
  })
  it('пропущенные релизы — все новее seen и не новее сборки', () => {
    expect(pendingWhatsNew(E, '6.3.4', '6.5.0').show.map((e) => e.version)).toEqual(['6.5.0', '6.4.0'])
    expect(pendingWhatsNew(E, '6.3.4', '6.4.0').show.map((e) => e.version)).toEqual(['6.4.0'])
  })
  it('уже видел — ничего; патч без записи — тихо двигаем отметку', () => {
    expect(pendingWhatsNew(E, '6.5.0', '6.5.0')).toEqual({ show: [], markSeen: null })
    expect(pendingWhatsNew(E, '6.5.0', '6.5.1')).toEqual({ show: [], markSeen: '6.5.1' })
  })
})

describe('mergeForSheet', () => {
  it('главное из всех записей (свежие первыми), лишнее — в мелочи', () => {
    const m = mergeForSheet([E[0], E[1]])
    expect(m.version).toBe('6.5.0')
    expect(m.main.map((x) => x.t)).toEqual(['A1', 'A2', 'B1', 'B2'])
    expect(m.minor.map((x) => x.t)).toEqual(['B3', 'Am', 'Bm'])
    expect(m.count).toBe(2)
  })
  it('пусто → null', () => expect(mergeForSheet([])).toBeNull())
})

describe('versionJson (v7.5.0)', () => {
  const E = [{ version: '7.5.0', headline: 'Новое', main: [{ t: 'a' }], push: false }, { version: '7.4.0', main: [{ t: 'b' }] }]
  it('push: false у свежей записи — silent; иначе поля нет', () => {
    expect(versionJson(E, '7.5.0')).toEqual({ version: '7.5.0', epoch: 2, headline: 'Новое', silent: true })
    expect(versionJson(E.slice(1), '7.4.0')).toEqual({ version: '7.4.0', epoch: 2, headline: 'b' })
  })
  it('запись не про эту версию — без заголовка и без silent', () => {
    expect(versionJson(E, '7.5.1')).toEqual({ version: '7.5.1', epoch: 2, headline: null })
  })
})

describe('hasUnopened / updateHeadline / дата', () => {
  it('метка «новое» пока свежая запись не открыта', () => {
    expect(hasUnopened(E, null)).toBe(true)
    expect(hasUnopened(E, '6.4.0')).toBe(true)
    expect(hasUnopened(E, '6.5.0')).toBe(false)
  })
  it('заголовок строки обновления', () => {
    // отдельным предложением, без тире: оно переносилось в начало строки на экране блокировки (fb_2e35a5f0)
    expect(updateHeadline({ headline: 'Новое', main: [1, 2, 3], minor: [4] })).toBe('Новое. И еще 2 улучшения')
    expect(updateHeadline({ headline: 'Новое', main: [1, 2, 3], minor: [4, 5, 6, 7, 8, 9, 10] })).toBe('Новое. И еще 8 улучшений')
    expect(updateHeadline({ headline: 'Готово!', main: [1, 2, 3] })).toBe('Готово! И еще 1 улучшение')
    expect(updateHeadline({ headline: 'Новое', main: [1, 2], minor: [] })).toBe('Новое')
    expect(updateHeadline(null)).toBeNull()
  })
  it('дата словами', () => {
    expect(fmtWhatsNewDate('2026-10-01')).toBe('1 октября')
    expect(fmtWhatsNewDate('')).toBe('')
  })
  it('отметки переживают сломанное хранилище', () => {
    const broken = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') } }
    expect(readMark('k', broken)).toBeNull()
    expect(() => writeMark('k', 'v', broken)).not.toThrow()
  })
})

describe('content/whatsNew — правила записей', () => {
  it('свежие сверху (эпоха, затем версия), по одной на выпуск, пункты в одну строку', () => {
    for (let i = 1; i < WHATS_NEW.length; i++) {
      const a = WHATS_NEW[i - 1], b = WHATS_NEW[i]
      const ea = a.epoch ?? VERSION_EPOCH, eb = b.epoch ?? VERSION_EPOCH
      expect(ea >= eb).toBe(true)
      if (ea === eb) expect(cmpVersion(a.version, b.version)).toBe(1)
      expect(a.date >= b.date).toBe(true)
    }
    for (const e of WHATS_NEW) {
      expect(e.main.length).toBeGreaterThan(0)
      expect(e.main.length).toBeLessThanOrEqual(4)
      expect((e.headline ?? '').length).toBeLessThanOrEqual(45)
      for (const it of [...e.main, ...e.minor]) {
        expect(it.t.length).toBeLessThanOrEqual(70)
        // Уточнения (v8.0.0): строки до 60 символов, не больше 5 на пункт.
        if (it.sub !== undefined) {
          expect(Array.isArray(it.sub)).toBe(true)
          expect(it.sub.length).toBeLessThanOrEqual(5)
          for (const s of it.sub) expect(typeof s === 'string' && s.length > 0 && s.length <= 60).toBe(true)
        }
      }
    }
  })
  it('свежая запись — версия из package.json (запись обязана попасть в релиз)', async () => {
    const pkg = await import('../../package.json')
    expect(WHATS_NEW[0].version).toBe(pkg.default.version)
  })
})

describe('эпохи нумерации (v1.0.0 э2)', () => {
  const E2 = [
    { version: '1.1.0', date: '2026-10-25', main: [{ t: 'new2' }] },
    { version: '1.0.0', date: '2026-10-19', main: [{ t: 'new1' }] },
    { version: '9.6.0', date: '2026-10-19', epoch: 1, main: [{ t: 'old' }] },
  ]
  it('записи старой эпохи не идут ни в лист, ни в метку «новое»', () => {
    expect(ofEpoch(E2).map((e) => e.version)).toEqual(['1.1.0', '1.0.0'])
    expect(pendingWhatsNew(E2, '1.0.0', '1.1.0').show.map((e) => e.version)).toEqual(['1.1.0'])
    expect(pendingWhatsNew(E2.slice(1), null, '1.0.0', { knownDevice: true }).show.map((e) => e.version)).toEqual(['1.0.0'])
    expect(hasUnopened(E2.slice(1), '1.0.0')).toBe(false)
    expect(hasUnopened(E2, '1.0.0')).toBe(true)
  })
  it('свежая запись в content — текущей эпохи, version.json несет эпоху', () => {
    expect(WHATS_NEW[0].epoch ?? VERSION_EPOCH).toBe(VERSION_EPOCH)
    expect(versionJson(WHATS_NEW, WHATS_NEW[0].version).epoch).toBe(VERSION_EPOCH)
  })
})
