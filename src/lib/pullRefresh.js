// Чистые хелперы жеста «потянуть вниз для обновления» (pull-to-refresh): Лента, «Уведомления».
// Без DOM/React/сети — только математика жеста, чтобы покрыть тестами (по образцу
// backoff.js / realtimeSync.js). Потребитель — hooks/usePullToRefresh.js.

export const PULL_THRESHOLD = 64   // px визуального сдвига, чтобы жест сработал
export const PULL_MAX = 120        // к этому сдвигу экран подходит, но не упирается
export const PULL_RESISTANCE = 0.7 // наклон «резины» в начале: палец 10 px → экран ~7 px
export const PULL_HOLD = 52        // px: на столько экран опущен, пока идет обновление (колесико в зазоре)

// Визуальный сдвиг экрана по «сырому» вертикальному смещению пальца. Тянем только
// вниз (raw > 0); вверх и вбок — 0. Мягкая «резина», как в iOS (fb_f8a87f1a, 28.10.2026): в начале
// экран идет почти за пальцем, дальше тянется все туже и плавно подходит к max — без жесткого упора,
// на котором раньше экран вставал как вкопанный.
export function pullDistance(rawDelta, { resistance = PULL_RESISTANCE, max = PULL_MAX } = {}) {
  if (!(rawDelta > 0)) return 0
  return max * (1 - Math.exp((-rawDelta * resistance) / max))
}

// Достаточно ли протянули, чтобы запустить обновление (на отпускании пальца).
export function shouldTriggerRefresh(distance, threshold = PULL_THRESHOLD) {
  return distance >= threshold
}
