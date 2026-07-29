import { useState } from 'react'
import { fmtMetricValue } from '../lib/metric.js'

// Список личных рекордов профиля (тап по строке → «Прогресс»). Презентационный:
// records + onOpenProgress(exId) приходят от ProfileScreen. По умолчанию видны
// первые пять записей, полный список раскрывается по запросу. Золотая звезда
// остаётся только у жима; значение форматируется по метрике (кг/повт./мин:сек).
// Пустой список → ничего не рендерим.
const PREVIEW_LIMIT = 5

export default function PersonalRecords({ records, onOpenProgress }) {
  const [expanded, setExpanded] = useState(false)
  if (!records?.length) return null
  const hasMore = records.length > PREVIEW_LIMIT
  const visibleRecords = expanded ? records : records.slice(0, PREVIEW_LIMIT)

  return (
    <section className="sec">
      <div className="pr-head">
        <p className="sec-title">Личные рекорды</p>
        <span className="pr-count" aria-label={`${records.length} рекордов`}>
          {records.length}
        </span>
      </div>
      <ul className="pr-list">
        {visibleRecords.map((r) => (
          <li key={r.exId}>
            <button className="pr-row" onClick={() => onOpenProgress?.(r.exId)}>
              <span className="pr-name">
                <span className="star-slot" aria-hidden="true">
                  {r.isBench && <span className="star">★</span>}
                </span>
                <span className="txt">{r.name}</span>
              </span>
              <span className="pr-val">
                {fmtMetricValue(r.metric, r.value)} <span className="arr">›</span>
              </span>
            </button>
          </li>
        ))}
        {hasMore && (
          <li className="pr-more">
            <button
              className="pr-toggle"
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              <span>{expanded ? 'Свернуть' : `Показать все ${records.length}`}</span>
              <span className="pr-toggle-arr" aria-hidden="true">
                {expanded ? '⌃' : '⌄'}
              </span>
            </button>
          </li>
        )}
      </ul>
    </section>
  )
}
