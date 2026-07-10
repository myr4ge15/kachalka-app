// Чистые хелперы жеста «потянуть вниз для обновления» (pull-to-refresh) на Ленте.
// Без DOM/React/сети — только математика жеста, чтобы покрыть тестами (по образцу
// backoff.js / realtimeSync.js). Потребитель — FeedScreen (touch-обработчики на
// скроллере .content).

export const PULL_THRESHOLD = 64   // px визуального сдвига, чтобы жест сработал
export const PULL_MAX = 96         // потолок визуального сдвига (дальше «не тянется»)
export const PULL_RESISTANCE = 0.5 // «резина»: палец проходит вдвое больше видимого

// Визуальный сдвиг ленты по «сырому» вертикальному смещению пальца. Тянем только
// вниз (raw > 0); вверх и вбок — 0. Применяем сопротивление и упираемся в потолок,
// чтобы жест ощущался упруго, а не улетал за экран.
export function pullDistance(rawDelta, { resistance = PULL_RESISTANCE, max = PULL_MAX } = {}) {
  if (!(rawDelta > 0)) return 0
  return Math.min(rawDelta * resistance, max)
}

// Достаточно ли протянули, чтобы запустить обновление (на отпускании пальца).
export function shouldTriggerRefresh(distance, threshold = PULL_THRESHOLD) {
  return distance >= threshold
}
