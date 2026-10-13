// Кэш онлайн-списков Админки на время одного визита (v8.0.1).
//
// Раньше каждый раздел («Пользователи», «Приглашения», «Обращения», «Доступ») грузил
// свой список при КАЖДОМ раскрытии: ~0,3–0,6 с пустоты, плюс отложенный каркас.
// Теперь экран при входе запрашивает все списки параллельно (prefetch), раздел
// рисует готовое сразу и обновляет в фоне, если данные старше MAX_AGE_MS.
// Одинаковые запросы в полете склеиваются (users нужен двум разделам).
//
// Только память экрана: создается в AdminScreen и умирает вместе с ним — ни Dexie,
// ни localStorage (данные админские, на общем телефоне не должны переживать выход).
// Ошибки не кэшируются: следующий load() пойдет в сеть заново.

export const MAX_AGE_MS = 20_000

export function createAdminCache(now = () => Date.now()) {
  const store = new Map() // key → { data?, at?, promise? }

  function peek(key) {
    return store.get(key)?.data
  }

  // Свежие ли данные (есть и моложе MAX_AGE_MS).
  function isFresh(key) {
    const e = store.get(key)
    return !!e && 'data' in e && now() - e.at < MAX_AGE_MS
  }

  // force — мимо кэша (после мутации). Без force: свежее — из памяти, в полете — тот же промис.
  function load(key, fetcher, { force = false } = {}) {
    const e = store.get(key) ?? {}
    if (!force && e.promise) return e.promise
    if (!force && isFresh(key)) return Promise.resolve(e.data)
    const promise = Promise.resolve()
      .then(fetcher)
      .then(
        (data) => {
          store.set(key, { data, at: now() })
          return data
        },
        (err) => {
          const cur = store.get(key)
          if (cur?.promise === promise) store.set(key, { ...cur, promise: undefined })
          throw err
        },
      )
    store.set(key, { ...e, promise })
    return promise
  }

  // Данные остаются для мгновенного показа, но следующий load() сходит в сеть
  // (после оптимистичной правки, которую раздел держит только у себя).
  function invalidate(key) {
    const e = store.get(key)
    if (e && 'data' in e) store.set(key, { ...e, at: -Infinity })
  }

  function clear() {
    store.clear()
  }

  return { peek, isFresh, load, invalidate, clear }
}
