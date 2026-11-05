// Только известные production-адреса: прямой URL второй Pages-сборки не считается новым доменом.
export function migrationDomain(location, beta = false) {
  if (beta || location?.protocol !== 'https:') return null
  if (location.hostname === 'kachalka-app.ru' && location.pathname.startsWith('/app/')) return 'new'
  if (location.hostname === 'myr4ge15.github.io' && location.pathname.startsWith('/kachalka-app/')
    && !location.pathname.startsWith('/kachalka-app/app/')) return 'old'
  return null
}

export const MIGRATION_STATES = {
  ready: 'Все сохранено на последней проверке',
  draft: 'Есть незавершенная тренировка или правки',
  pending: 'Есть неотправленные изменения',
  sync: 'Синхронизация не завершилась',
  offline: 'Нет сети',
  account: 'Учетка сменилась во время проверки',
  error: 'Не удалось проверить данные',
  unknown: 'Сохранение еще не проверено',
}

export function migrationSummary(devices, now = Date.now()) {
  const old = devices.filter((d) => d.domain === 'old')
  const recentOld = old.some((d) => now - Date.parse(d.last_seen_at) <= 7 * 86400000)
  return {
    newSeen: devices.some((d) => d.domain === 'new'),
    recentOld,
    old,
    // Ноль устройств — неизвестность, а не «все сохранено».
    oldReady: old.length > 0 && old.every((d) => d.save_state === 'ready' && d.checked_at),
  }
}
