// ============================================================================
// Единый хаб событий «сеть / возврат на вкладку».
//
// Раньше слушатели `online` / `offline` / `visibilitychange` навешивались по
// отдельности в sync.js, FeedScreen и Leaderboard — три набора слушателей и
// три независимые реакции. Здесь DOM-слушатели регистрируются ОДИН раз, а
// потребители подписываются на логические события:
//   onOnline   — появилась сеть;
//   onOffline  — сеть пропала;
//   onResume   — вкладка снова стала видимой;
//   onReselect — повторный тап по УЖЕ активной вкладке (payload — её id): экраны
//                используют как «обнови меня» (напр. Лента перезапрашивает посты).
// Каждая подписка возвращает функцию отписки.
// ============================================================================
const subs = { online: new Set(), offline: new Set(), resume: new Set(), reselect: new Set() }
let started = false

function emit(kind, payload) {
  for (const fn of subs[kind]) {
    try { fn(payload) } catch (err) { console.error('appEvents listener error:', err) }
  }
}

function ensureStarted() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('online', () => emit('online'))
  window.addEventListener('offline', () => emit('offline'))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') emit('resume')
  })
}

function on(kind, fn) {
  ensureStarted()
  subs[kind].add(fn)
  return () => subs[kind].delete(fn)
}

export const onOnline = (fn) => on('online', fn)
export const onOffline = (fn) => on('offline', fn)
export const onResume = (fn) => on('resume', fn)

// Повторный тап по активной вкладке. Payload — id вкладки, эмитит App.goTab.
export const onReselect = (fn) => on('reselect', fn)
export const emitReselect = (tab) => emit('reselect', tab)
