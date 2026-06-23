// Простейший кэш в памяти, переживающий размонтирование вкладок.
// Зачем: вкладки рендерятся условно и при переключении компонент монтируется
// заново, теряя состояние, — и каждый раз тянет данные по сети с нуля.
// С кэшем повторный вход во вкладку показывает данные мгновенно, а свежие
// подгружаются в фоне.
const store = new Map()

export function getCache(key) {
  return store.get(key)
}

export function setCache(key, value) {
  store.set(key, value)
  return value
}

export function clearCache(key) {
  if (key === undefined) store.clear()
  else store.delete(key)
}
