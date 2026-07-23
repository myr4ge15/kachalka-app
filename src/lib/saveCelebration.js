// Чистый выбор ЕДИНОГО поздравительного тоста после сохранения тренировки
// (вырезано из WorkoutScreen.save, чтобы приоритет/формат стали тестируемыми).
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
import { fmtMetricValue } from './metric.js'

export function pickSaveCelebration({ prs = [], reached = [], newBadges = [], insights = [] } = {}) {
  // Достижение личной цели — высший приоритет показа (перебивает рекорд).
  if (reached.length) {
    const top = reached.reduce((a, b) => (Number(b.value) > Number(a.value) ? b : a), reached[0])
    const extra = reached.length > 1 ? ` +${reached.length - 1}` : ''
    // Повторы при целевом весе (PLAN-goal-reps) — показываем «× N», как в карточке цели.
    const repsStr = top.metric === 'weight' && Number(top.reps) > 0 ? ` × ${Math.round(Number(top.reps))}` : ''
    return {
      celebrated: true,
      toast: {
        emoji: '🎯',
        title: reached.length > 1 ? 'Цели достигнуты!' : 'Цель достигнута!',
        sub: `${top.name} — ${fmtMetricValue(top.metric, top.value)}${repsStr}${extra}`,
      },
    }
  }
  // Новый личный рекорд.
  if (prs.length) {
    const top = prs.reduce((a, b) => (b.value > a.value ? b : a), prs[0])
    const extra = prs.length > 1 ? ` +${prs.length - 1}` : ''
    return {
      celebrated: true,
      toast: {
        title: 'Новый рекорд!',
        sub: `${top.name} — ${fmtMetricValue(top.metric, top.value)} (было ${fmtMetricValue(top.metric, top.prev)})${extra}`,
      },
    }
  }
  // Достижение/бейдж (тост только если рекорд/цель не перекрыли — они вернулись выше).
  if (newBadges.length) {
    const extra = newBadges.length > 1 ? ` +${newBadges.length - 1}` : ''
    return {
      celebrated: true,
      toast: {
        emoji: '🏆',
        title: newBadges.length > 1 ? 'Новые достижения!' : 'Новое достижение!',
        sub: `${newBadges[0].icon} ${newBadges[0].name}${extra}`,
      },
    }
  }
  // Инсайт после «тихой» тренировки: тост есть, но вибрация обычная (celebrated=false).
  if (insights.length) {
    return {
      celebrated: false,
      toast: { emoji: insights[0].emoji, title: 'Вывод после тренировки', sub: insights[0].text },
    }
  }
  return { celebrated: false, toast: null }
}
