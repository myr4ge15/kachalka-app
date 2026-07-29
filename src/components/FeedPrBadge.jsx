import { fmtMetricValue } from '../lib/metric.js'

// Компактный PR-бейдж для карточки Ленты: длинное название можно ужать
// многоточием, но значение рекорда всегда остаётся видимым целиком.
export default function FeedPrBadge({ pr }) {
  const value = fmtMetricValue(pr.metric, pr.value)

  return (
    <span
      className="pr-badge"
      title={`Новый личный рекорд: ${pr.name} — ${value}`}
    >
      <span className="pr-badge-icon" aria-hidden="true">🏆</span>
      <span className="pr-badge-name">{pr.name}</span>
      <span className="pr-badge-value">· {value}</span>
    </span>
  )
}
