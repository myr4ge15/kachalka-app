// Тесты слияния личного meta между устройствами (lib/userMeta.js). Фокус —
// краевые кейсы, ради которых мы не взяли тупой last-write-wins: откат метки
// «прочитано» назад и потеря бейджа, полученного офлайн на другом устройстве.
import { describe, it, expect } from 'vitest'
import { mergeMetaValue, planMetaSync, sameMetaValue, SYNCED_KINDS, metaKeyFor } from './userMeta.js'

const NOW = '2026-07-24T12:00:00.000Z'

describe('metaKeyFor / SYNCED_KINDS', () => {
  it('локальный ключ = род + userId (прежние ключи Dexie не меняются)', () => {
    expect(metaKeyFor('badges', 'u1')).toBe('badges_u1')
    expect(metaKeyFor('notif_seen_at', 'u1')).toBe('notif_seen_at_u1')
  })

  it('синкаем ровно три рода ключей', () => {
    expect(SYNCED_KINDS).toEqual(['badges', 'prog', 'notif_seen_at'])
  })
})

describe('sameMetaValue', () => {
  it('порядок ключей объекта не считается изменением', () => {
    expect(sameMetaValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  })

  it('null и undefined — одно «пусто», а null vs {} — нет', () => {
    expect(sameMetaValue(null, undefined)).toBe(true)
    expect(sameMetaValue(null, {})).toBe(false)
  })
})

describe('mergeMetaValue: notif_seen_at', () => {
  const merge = (local, remote) => mergeMetaValue({ kind: 'notif_seen_at', local, remote })

  it('берёт максимум времени (метка «прочитано» не откатывается назад)', () => {
    expect(merge('2026-07-01T00:00:00.000Z', '2026-07-10T00:00:00.000Z')).toBe('2026-07-10T00:00:00.000Z')
    expect(merge('2026-07-10T00:00:00.000Z', '2026-07-01T00:00:00.000Z')).toBe('2026-07-10T00:00:00.000Z')
  })

  it('пустая сторона не затирает непустую', () => {
    expect(merge(null, '2026-07-10T00:00:00.000Z')).toBe('2026-07-10T00:00:00.000Z')
    expect(merge('2026-07-10T00:00:00.000Z', null)).toBe('2026-07-10T00:00:00.000Z')
  })
})

describe('mergeMetaValue: badges', () => {
  const merge = (local, remote) => mergeMetaValue({ kind: 'badges', local, remote })

  it('объединяет вехи с обоих устройств', () => {
    const out = merge(
      { first: { at: '2026-01-01T00:00:00.000Z' } },
      { hundred: { at: '2026-02-01T00:00:00.000Z' } }
    )
    expect(Object.keys(out).sort()).toEqual(['first', 'hundred'])
  })

  it('у общей вехи держит САМУЮ РАННЮЮ дату получения', () => {
    const out = merge(
      { first: { at: '2026-03-01T00:00:00.000Z' } },
      { first: { at: '2026-01-05T00:00:00.000Z' } }
    )
    expect(out.first.at).toBe('2026-01-05T00:00:00.000Z')
  })

  it('живое получение не деградирует до backfilled', () => {
    const out = merge(
      { first: { at: '2026-01-01T00:00:00.000Z', backfilled: false } },
      { first: { at: '2026-01-01T00:00:00.000Z', backfilled: true } }
    )
    expect(out.first.backfilled).toBe(false)
  })

  it('историческая с обеих сторон остаётся исторической', () => {
    const out = merge(
      { first: { at: '2026-01-01T00:00:00.000Z', backfilled: true } },
      { first: { at: '2026-01-02T00:00:00.000Z', backfilled: true } }
    )
    expect(out.first.backfilled).toBe(true)
  })
})

describe('mergeMetaValue: prog (last-write-wins)', () => {
  const local = { enabled: false, byExercise: {} }
  const remote = { enabled: true, byExercise: {} }

  it('позднее правленное побеждает', () => {
    expect(mergeMetaValue({ kind: 'prog', local, remote, localAt: '2026-07-01', remoteAt: '2026-07-02' })).toBe(remote)
    expect(mergeMetaValue({ kind: 'prog', local, remote, localAt: '2026-07-03', remoteAt: '2026-07-02' })).toBe(local)
  })

  it('при равных отметках оставляем локальное (не дёргаем экран зря)', () => {
    expect(mergeMetaValue({ kind: 'prog', local, remote, localAt: '2026-07-02', remoteAt: '2026-07-02' })).toBe(local)
  })
})

describe('planMetaSync', () => {
  it('строки на сервере нет, локально есть → бэкофилл (dirty без перезаписи)', () => {
    const p = planMetaSync({
      kind: 'badges', local: { first: { at: '2026-01-01' } }, remote: null,
      localAt: '2026-01-01', remoteAt: '', hasRemote: false, now: NOW,
    })
    expect(p).toMatchObject({ write: false, dirty: 1, at: '2026-01-01' })
  })

  it('пусто с обеих сторон → ничего не делаем', () => {
    const p = planMetaSync({
      kind: 'prog', local: null, remote: null,
      localAt: '', remoteAt: '', hasRemote: false, now: NOW,
    })
    expect(p).toMatchObject({ value: null, write: false, dirty: 0 })
  })

  it('сервер новее → пишем локально, отправлять нечего, watermark серверный', () => {
    const p = planMetaSync({
      kind: 'notif_seen_at', local: '2026-07-01T00:00:00.000Z', remote: '2026-07-10T00:00:00.000Z',
      localAt: '2026-07-01', remoteAt: '2026-07-10T00:00:01.000Z', hasRemote: true, now: NOW,
    })
    expect(p).toMatchObject({
      value: '2026-07-10T00:00:00.000Z', write: true, dirty: 0, at: '2026-07-10T00:00:01.000Z',
    })
  })

  it('локальное новее → локально ничего не трогаем, но отправляем наверх', () => {
    const p = planMetaSync({
      kind: 'notif_seen_at', local: '2026-07-20T00:00:00.000Z', remote: '2026-07-10T00:00:00.000Z',
      localAt: '2026-07-20', remoteAt: '2026-07-10T00:00:01.000Z', hasRemote: true, now: NOW,
    })
    expect(p).toMatchObject({ value: '2026-07-20T00:00:00.000Z', write: false, dirty: 1, at: NOW })
  })

  it('слияние бейджей дало третье состояние → и пишем локально, и шлём на сервер', () => {
    const p = planMetaSync({
      kind: 'badges',
      local: { first: { at: '2026-01-01T00:00:00.000Z' } },
      remote: { hundred: { at: '2026-02-01T00:00:00.000Z' } },
      localAt: '2026-01-01', remoteAt: '2026-02-01T00:00:01.000Z', hasRemote: true, now: NOW,
    })
    expect(Object.keys(p.value).sort()).toEqual(['first', 'hundred'])
    expect(p).toMatchObject({ write: true, dirty: 1, at: NOW })
  })

  it('состояния совпали → ни записи, ни отправки', () => {
    const same = { enabled: true, byExercise: { ex1: { step: 2.5 } } }
    const p = planMetaSync({
      kind: 'prog', local: same, remote: { byExercise: { ex1: { step: 2.5 } }, enabled: true },
      localAt: '2026-07-01', remoteAt: '2026-07-02', hasRemote: true, now: NOW,
    })
    expect(p).toMatchObject({ write: false, dirty: 0, at: '2026-07-02' })
  })
})
