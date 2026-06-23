// ============================================================================
// Единый хаб событий «сеть / возврат на вкладку».
//
// Раньше слушатели `online` / `offline` / `visibilitychange` навешивались по
// отдельности в sync.js, FeedScreen и Leaderboard — три набора слушателей и
// три независимые реакции. Здесь DOM-слушатели регистрируются ОДИН раз, а
// потребители подписываются на логические события:
//   onOnline  — появилась сеть;
//   onOffline — сеть пропала;
//   onResume  — вкладка снова стала видимой.
// Каждая подписка возвращает функцию отписки.
// ============================================================================
const subs = { online: new Set(), offline: new Set(), resume: new Set() }
let started = false

function emit(kind) {
  for (const fn of subs[kind]) {
    try { fn() } catch (err) { console.error('appEvents listener error:', err) }
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
