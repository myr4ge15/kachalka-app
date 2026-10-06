// Безопасный доступ к Web Storage (РЕВЬЮ-КОДА-2026-10-02; вынесено из App.jsx в v6.14.1):
// в Safari с блокировкой cookie/«Частном доступе» уже ОБРАЩЕНИЕ к window.localStorage
// бросает SecurityError. Без обертки падал эффект восстановления сессии — markAppReady
// не звался, и заставка висела до страховочного таймера, а запись вкладки роняла
// рендер. Хранилище тут — удобство: при отказе ведем себя как «пусто».
// area — 'localStorage' | 'sessionStorage'.
export function storageGet(area, key) {
  try { return window[area]?.getItem(key) ?? null } catch { return null }
}
export function storageSet(area, key, value) {
  try { window[area]?.setItem(key, value) } catch { /* хранилище недоступно — живем без него */ }
}
export function storageRemove(area, key) {
  try { window[area]?.removeItem(key) } catch { /* хранилище недоступно — живем без него */ }
}
