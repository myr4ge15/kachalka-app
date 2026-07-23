import { fmtMetricValue } from '../lib/metric.js'

// Список личных рекордов профиля (тап по строке → «Прогресс»). Презентационный:
// records + onOpenProgress(exId) приходят от ProfileScreen. Звезда тусклая у
// не-жимовых упражнений; значение форматируется по метрике (кг/повт./мин:сек).
// Пустой список → ничего не рендерим (сам гард, как было в экране).
export default function PersonalRecords({ records, onOpenProgress }) {
  if (!records?.length) return null
  return (
    <section className="sec">
      <p className="sec-title">Личные рекорды · тап → Прогресс</p>
      <ul className="pr-list">
        {records.map((r) => (
          <li key={r.exId}>
            <button className="pr-row" onClick={() => onOpenProgress?.(r.exId)}>
              <span className="pr-name">
                <span className={'star' + (r.isBench ? '' : ' dim')}>★</span>
                <span className="txt">{r.name}</span>
              </span>
              <span className="pr-val">
                {fmtMetricValue(r.metric, r.value)} <span className="arr">›</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">
        Графики по дням и «форма сейчас» — на экране «Прогресс».
      </p>
    </section>
  )
}
