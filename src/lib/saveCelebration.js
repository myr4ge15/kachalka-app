// Legacy-адаптер тоста поверх новой модели finish-event. Runtime после v5.11.1
// показывает событие внутри WorkoutFinishSheet; экспорт оставлен совместимым
// для старых потребителей и тестов формата.
//
// Приоритет ПОКАЗА (перекрывают друг друга сверху вниз, показываем ОДИН тост):
//   цель → рекорд → бейдж → инсайт.
// NB: цель ПЕРЕБИВАЕТ рекорд намеренно (как в исходном save: тост цели идёт после
// и «важнее» — совпадение рекорда с достижением цели показывает цель).
//
// `celebrated` (для «праздничной» вибрации, см. HAPTIC.celebrate) — true, если
// сработало рекорд/цель/бейдж; инсайт тост показывает, но празднование обычное
// (success), поэтому у него celebrated=false — паритет с прежним поведением.
//
// Возвращает { celebrated, toast }: toast=null → показывать нечего (обычный
// success). Формирование payload'а тоста здесь, чтобы UI лишь звал showToast(toast).
import { pickWorkoutFinishEvent } from './workoutFinish.js'

export function pickSaveCelebration(input = {}) {
  const event = pickWorkoutFinishEvent(input)
  if (!event) return { celebrated: false, toast: null }
  return {
    celebrated: event.celebrated,
    toast: {
      ...(event.kind === 'pr' ? {} : { emoji: event.emoji }),
      title: event.title,
      sub: event.text,
    },
  }
}
