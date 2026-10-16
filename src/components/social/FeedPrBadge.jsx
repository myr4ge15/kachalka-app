import { fmtMetricValue } from '../../lib/metric.js'

// Рекорд в строке упражнения Ленты и профиля участника: «🏆 90 кг» сразу за названием.
// Аудит 16.10: раньше — отдельные плашки над списком с тем же названием, что и строка
// ниже: рекорд показывался дважды, а карточка росла на ряд-два. Имя — только в подсказке
// и для скринридера, на экране оно уже есть в строке.
export default function FeedPrBadge({ pr }) {
  const value = fmtMetricValue(pr.metric, pr.value)
  return (
    <span className="pr-mark" title={`Новый личный рекорд: ${pr.name} — ${value}`}
      aria-label={`новый рекорд ${value}`}>
      <span aria-hidden="true">🏆 {value}</span>
    </span>
  )
}

// Рекорд этой строки (у рекорда нет id упражнения — сверяем по имени, как в db/feed.js).
export const prForEntry = (w, e) => w.prs?.find((p) => p.name === e.name) ?? null
