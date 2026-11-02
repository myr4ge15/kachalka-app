import { useMemo, useState } from 'react'
import { monthOf, shiftMonth, localYmd } from '../../lib/calendar.js'
import { buildMonthlySummary, monthKey, monthLabel } from '../../lib/monthlySummary.js'
import { fmtMetricValue, fmtSetList } from '../../lib/metric.js'
import { mainEntries, entryUnitMetric } from '../../lib/entries.js'
import './MonthlySummary.css'

export default function MonthlySummary({ workouts }) {
  const [month, setMonth] = useState(() => shiftMonth(monthOf(new Date()), -1))
  const [expanded, setExpanded] = useState(false)
  const summary = useMemo(() => buildMonthlySummary(workouts, month), [workouts, month])
  if (!summary.available) return null
  const firstMonth = [...workouts].filter((w) => !w._deleted && localYmd(w.performed_at)).map((w) => localYmd(w.performed_at).slice(0, 7)).sort()[0]
  const changeMonth = (offset) => { setMonth(shiftMonth(month, offset)); setExpanded(false) }
  const delta = summary.count - summary.previousCount
  return (
    <section className="card monthly-summary" aria-label="Итоги месяца">
      <h3>Итоги месяца</h3>
      <div className="monthly-nav">
        <button type="button" aria-label="Предыдущий месяц" disabled={summary.key <= firstMonth} onClick={() => changeMonth(-1)}>‹</button>
        <strong aria-live="polite">{monthLabel(month)}</strong>
        <button type="button" aria-label="Следующий месяц" disabled={summary.key >= monthKey(monthOf(new Date()))} onClick={() => changeMonth(1)}>›</button>
      </div>
      {summary.current && <p className="muted">Месяц еще идет. Сравнение будет доступно после его окончания.</p>}
      {summary.count === 0 ? <p className="muted">За этот месяц пока нет тренировок.</p> : <>
        <dl className="monthly-stats">
          <div><dt>Тренировки</dt><dd>{summary.count}</dd></div>
          <div><dt>Рабочие подходы</dt><dd>{summary.sets}</dd></div>
          <div><dt>Активные дни</dt><dd>{summary.activeDays}</dd></div>
        </dl>
        {!summary.current && summary.previousCount > 0 && <p className="muted">
          К прошлому месяцу: {delta > 0 ? '+' : ''}{delta} трен.
          {summary.setsChange !== null && ` · ${summary.setsChange > 0 ? '+' : ''}${summary.setsChange}% подходов`}
        </p>}
        {summary.records.length > 0 && <div><h4>🏆 Личные рекорды</h4><ul>
          {summary.records.map((r) => <li key={r.id}>{r.name}: {fmtMetricValue(r.metric, r.value)}{r.metric === 'reps' ? ' повт.' : r.metric === 'time' ? ' мин:сек' : ''}</li>)}
        </ul></div>}
        {summary.groups.length > 0 && <p>Больше всего подходов: {summary.groups.join(', ')}.</p>}
        <button type="button" className="btn" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Скрыть тренировки месяца' : 'Посмотреть тренировки месяца'}
        </button>
        {expanded && <ul className="monthly-workouts">{summary.workouts.map((w) => <li key={w.id}>
          <strong>{new Date(`${localYmd(w.performed_at)}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</strong>
          {mainEntries(w).map((e, i) => <p key={i}>{e.exercise?.name ?? e.name ?? 'Упражнение'}: {fmtSetList(entryUnitMetric(e), e.sets)}</p>)}
        </li>)}</ul>}
      </>}
    </section>
  )
}
