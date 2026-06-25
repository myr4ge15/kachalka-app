// Простейший кэш в памяти, переживающий размонтирование вкладок.
// Зачем: вкладки рендерятся условно и при переключении компонент монтируется
// заново, теряя состояние, — и каждый раз тянет данные по сети с нуля.
// С кэшем повторный вход во вкладку показывает данные мгновенно, а свежие
// подгружаются в фоне.
const store = new Map()

// Потолок числа ключей. Кэш живёт весь сеанс (черновики, снимки вкладок) и без
// ограничения рос бы бесконечно. Map хранит порядок вставки — вытесняем самый
// старый ключ (простая LRU: чтение/запись помечают ключ как свежий).
const MAX_ENTRIES = 50

export function getCache(key) {
  if (!store.has(key)) return undefined
  // Освежаем позицию ключа (перемещаем в конец = «недавно использован»).
  const value = store.get(key)
  store.delete(key)
  store.set(key, value)
  return value
}

export function setCache(key, value) {
  if (store.has(key)) store.delete(key)
  store.set(key, value)
  if (store.size > MAX_ENTRIES) {
    // Вытесняем самый старый ключ (первый в порядке вставки).
    store.delete(store.keys().next().value)
  }
  return value
}

export function clearCache(key) {
  if (key === undefined) store.clear()
  else store.delete(key)
}
