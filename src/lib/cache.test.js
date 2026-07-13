import { describe, it, expect, beforeEach } from 'vitest'
import { getCache, setCache, clearCache } from './cache.js'

// store — модульный синглтон; чистим перед каждым тестом.
beforeEach(() => clearCache())

describe('cache (LRU)', () => {
  it('set/get возвращает значение; отсутствующий ключ → undefined', () => {
    setCache('a', 1)
    expect(getCache('a')).toBe(1)
    expect(getCache('нет')).toBeUndefined()
  })

  it('clearCache(key) удаляет один ключ; clearCache() — весь кэш', () => {
    setCache('a', 1); setCache('b', 2)
    clearCache('a')
    expect(getCache('a')).toBeUndefined()
    expect(getCache('b')).toBe(2)
    clearCache()
    expect(getCache('b')).toBeUndefined()
  })

  it('вытесняет самый старый ключ при переполнении (MAX_ENTRIES=50)', () => {
    // NB: не читаем k0 до переполнения — getCache освежил бы его позицию (LRU).
    for (let i = 0; i < 50; i++) setCache('k' + i, i) // ровно 50, k0 — самый старый
    setCache('k50', 50)            // 51-й → вытесняем самый старый (k0)
    expect(getCache('k0')).toBeUndefined()
    expect(getCache('k50')).toBe(50)
    expect(getCache('k1')).toBe(1) // соседи живы
  })

  it('get освежает позицию: недавно прочитанный НЕ вытесняется первым', () => {
    for (let i = 0; i < 50; i++) setCache('k' + i, i)
    getCache('k0')       // k0 — снова «свежий», теперь самый старый k1
    setCache('k50', 50)  // переполнение → вытесняем k1, а не k0
    expect(getCache('k0')).toBe(0)
    expect(getCache('k1')).toBeUndefined()
  })

  it('повторный set того же ключа освежает позицию (не плодит дубль)', () => {
    for (let i = 0; i < 50; i++) setCache('k' + i, i)
    setCache('k0', 999)  // обновление k0 → он становится самым свежим
    setCache('k50', 50)  // вытесняем k1 (самый старый), k0 жив
    expect(getCache('k0')).toBe(999)
    expect(getCache('k1')).toBeUndefined()
  })
})
