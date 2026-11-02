import { useMemo } from 'react'
import { monthOf, shiftMonth } from '../../lib/calendar.js'
import { buildMonthlySummary, monthKey, monthLabel } from '../../lib/monthlySummary.js'
import { fmtMetricValue } from '../../lib/metric.js'
import { plural } from '../../lib/plural.js'
import SheetDialog from '../ui/SheetDialog.jsx'
import CardsSkeleton from '../ui/CardsSkeleton.jsx'
import './MonthlySummary.css'

export default function MonthlySummary({ workouts, month = shiftMonth(monthOf(new Date()), -1), months, onMonthChange, celebrate = true, onDismiss, onOpenWorkouts, error = false, loading = false }) {
  const summary = useMemo(() => buildMonthlySummary(workouts, month), [workouts, month])
  return (
    <SheetDialog title="Итоги месяца" onDismiss={onDismiss} swipeDown className="monthly-sheet">
      {celebrate && !loading && summary.count > 0 && <div className="monthly-fireworks" aria-hidden="true">
        {[0, 1, 2].map((burst) => <div className="monthly-burst" key={burst} style={{ left: `${[22, 76, 48][burst]}%`, top: `${[25, 32, 17][burst]}%`, '--burst-delay': `${burst * 240}ms` }}>
          {Array.from({ length: 14 }, (_, i) => {
            const angle = i * Math.PI * 2 / 14
            const radius = 70 + (i % 3) * 14
            return <span key={i} style={{ '--spark-x': `${Math.cos(angle) * radius}px`, '--spark-y': `${Math.sin(angle) * radius + 28}px`, '--spark-color': `var(--${['acc', 'g4', 'g1'][i % 3]})` }} />
          })}
        </div>)}
      </div>}
      <div className="sheet-scroll monthly-summary">
        {months ? <label className="monthly-picker"><span className="muted">Месяц</span><select className="prog-select" aria-label="Месяц итогов" value={monthKey(month)} onChange={(e) => {
          const [year, selectedMonth] = e.target.value.split('-').map(Number)
          onMonthChange?.({ year, month: selectedMonth - 1 })
        }}>{months.map((m) => <option key={monthKey(m)} value={monthKey(m)}>{monthLabel(m)}</option>)}</select></label> : <p className="monthly-period">{monthLabel(month)}</p>}
        {loading ? <CardsSkeleton cards={1} /> : <>
        <h2 className="monthly-hero">{summary.count}<span>{plural(summary.count, 'тренировка', 'тренировки', 'тренировок')}</span></h2>
        {summary.count === 0 ? <p className="muted">За этот месяц пока нет тренировок.</p> : <>
          <dl className="monthly-stats">
            <div><dt>Рабочие подходы</dt><dd>{summary.sets}</dd></div>
            <div><dt>Активные дни</dt><dd>{summary.activeDays}</dd></div>
          </dl>
          {!summary.current && summary.previousCount > 0 && <p className="monthly-comparison">
            {summary.count === summary.previousCount ? 'Столько же тренировок, сколько в прошлом месяце' : `На ${Math.abs(summary.count - summary.previousCount)} ${plural(Math.abs(summary.count - summary.previousCount), 'тренировку', 'тренировки', 'тренировок')} ${summary.count > summary.previousCount ? 'больше' : 'меньше'}, чем в прошлом месяце`}
          </p>}
          {summary.records.length > 0 && <div className="monthly-records"><h3>🏆 Личные рекорды</h3>
            {summary.records.map((r) => <div className="monthly-record" key={r.id}><span>{r.name}</span><strong>{fmtMetricValue(r.metric, r.value)}{r.metric === 'reps' ? ' повт.' : r.metric === 'time' ? ' мин:сек' : ''}</strong></div>)}
          </div>}
          {summary.groups.length > 0 && <p className="muted">Больше всего подходов: {summary.groups.join(', ')}.</p>}
        </>}
        </>}
      </div>
      <div className="monthly-actions">
        {summary.count > 0 && <button type="button" className="btn primary full" onClick={onOpenWorkouts}>Тренировки за месяц</button>}
        <button type="button" className="link-btn" onClick={onDismiss}>Готово</button>
        {error && <p role="alert">Не удалось сохранить. Попробуй еще раз.</p>}
      </div>
    </SheetDialog>
  )
}
