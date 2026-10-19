// Расписание авто-повтора степпера при удержании (long-press auto-repeat) —
// чистая логика без React, тестируется в node.
//
// Первый повтор — через HOLD_START мс после нажатия; дальше интервал
// сокращается на HOLD_STEP до нижней границы HOLD_MIN («чем дольше держишь —
// тем быстрее бежит значение»).
export const HOLD_START = 300
export const HOLD_MIN = 40
export const HOLD_STEP = 25
// Сдвиг пальца (px), после которого касание — прокрутка, а не тап (fb_52059bc8).
export const HOLD_SLOP = 10

export function nextHoldDelay(prev) {
  return Math.max(HOLD_MIN, (Number(prev) || HOLD_START) - HOLD_STEP)
}
