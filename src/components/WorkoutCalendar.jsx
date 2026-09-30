import { useMemo, useRef, useState } from 'react'
import SheetDialog from './SheetDialog.jsx'
import {
  monthGrid, monthOf, shiftMonth, workoutsByDay, countInMonth, monthTitle, localYmd, WEEKDAYS_SHORT,
} from '../lib/calendar.js'
import { daySubTags, tagSlug } from '../lib/dayTags.js'
import { labelOf, majorOf } from '../lib/muscles.js'
import { exerciseMetric, fmtSet } from '../lib/metric.js'
import { plural } from '../lib/plural.js'

const DAY_TITLE = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

// Календарь тренировок (v6.3.0) — «поиск по дате», как в мессенджерах.
// Дни с тренировкой — залитые акцентом кружки, сегодня — обводка, 2+ тренировки
// за день — маленький счетчик. Тап по дню → сводка: мышцы дня и упражнения с
// подходами, «Открыть» ведет в саму тренировку. Никаких розовых/красных тонов —
// только акцент пользователя, чтобы экран читался как спортивный журнал.
//
// Пропсы:
//   workouts     — уже отфильтрованный список (фильтр группы из «Моих тренировок»)
//   filter       — активная группа (для подписи) или null
//   initialDate  — день, который открыть и выделить (Date/ISO); по умолчанию сегодня
//   onOpen(id)   — открыть тренировку; onDismiss — закрыть лист
export default function WorkoutCalendar({ workouts, filter = null, initialDate = null, onOpen, onDismiss }) {
  const today = useMemo(() => new Date(), [])
  const [month, setMonth] = useState(() => monthOf(initialDate ?? today))
  const [picked, setPicked] = useState(() => (initialDate ? localYmd(initialDate) : null))
  const byDay = useMemo(() => workoutsByDay(workouts), [workouts])
  const weeks = useMemo(() => monthGrid(month, { today }), [month, today])
  const count = countInMonth(byDay, month)
  const atCurrent = month.year === today.getFullYear() && month.month === today.getMonth()

  function go(n) {
    if (n > 0 && atCurrent) return // будущие месяцы пусты — не листаем туда
    setMonth((m) => shiftMonth(m, n))
    setPicked(null)
  }

  // Свайп по сетке: влево — следующий месяц, вправо — предыдущий.
  const touch = useRef(null)
  function onTouchStart(e) {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY }
  }
  function onTouchEnd(e) {
    const s = touch.current
    touch.current = null
    if (!s) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(t.clientY - s.y) * 1.5) go(dx < 0 ? 1 : -1)
  }

  const dayWorkouts = picked ? byDay.get(picked) ?? [] : []
  const pickedDate = picked ? new Date(`${picked}T12:00:00`) : null

  return (
    <SheetDialog title="Календарь" onDismiss={onDismiss}>
      <div className="sheet-scroll cal">
        <div className="cal-nav">
          <button type="button" className="back-btn" onClick={() => go(-1)} aria-label="Предыдущий месяц">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <div className="cal-title" aria-live="polite">
            <strong>{monthTitle(month)}</strong>
            <span className="muted">
              {count > 0 ? `${count} ${plural(count, 'тренировка', 'тренировки', 'тренировок')}` : 'без тренировок'}
              {filter ? ` · ${filter}` : ''}
            </span>
          </div>
          <button type="button" className="back-btn" onClick={() => go(1)} disabled={atCurrent}
            aria-label="Следующий месяц">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>

        <div className="cal-grid" role="grid" aria-label={monthTitle(month)}
          onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div className="cal-row cal-wd" role="row">
            {WEEKDAYS_SHORT.map((d) => <span key={d} role="columnheader">{d}</span>)}
          </div>
          {weeks.map((week) => (
            <div className="cal-row" role="row" key={week[0].ymd}>
              {week.map((d) => {
                const n = byDay.get(d.ymd)?.length ?? 0
                if (!d.inMonth) return <span key={d.ymd} className="cal-cell" role="gridcell" />
                const cls = 'cal-day'
                  + (n > 0 ? ' trained' : '')
                  + (d.today ? ' today' : '')
                  + (picked === d.ymd ? ' picked' : '')
                  + (d.future ? ' future' : '')
                return (
                  <span key={d.ymd} className="cal-cell" role="gridcell">
                    <button
                      type="button"
                      className={cls}
                      disabled={d.future}
                      aria-pressed={picked === d.ymd}
                      aria-label={`${d.day}${n > 0 ? `, ${n} ${plural(n, 'тренировка', 'тренировки', 'тренировок')}` : ''}${d.today ? ', сегодня' : ''}`}
                      onClick={() => setPicked(picked === d.ymd ? null : d.ymd)}
                    >
                      {d.day}
                      {n > 1 && <span className="cal-multi" aria-hidden="true">{n}</span>}
                    </button>
                  </span>
                )
              })}
            </div>
          ))}
        </div>

        <div className="cal-summary">
          {!picked && (
            <p className="muted cal-hint">
              {count > 0 ? 'Нажми на выделенный день — покажу мышцы и упражнения.' : 'В этом месяце тренировок нет.'}
            </p>
          )}
          {picked && (
            <>
              <h3 className="cal-day-title">{DAY_TITLE.format(pickedDate)}</h3>
              {dayWorkouts.length === 0 && <p className="muted cal-hint">В этот день тренировок не было.</p>}
              {dayWorkouts.map((w) => {
                const tags = daySubTags(w.entries)
                return (
                  <div key={w.id} className="card cal-workout">
                    {tags.length > 0 && (
                      <div className="day-tags">
                        {tags.map((s) => (
                          <span key={s} className={`day-tag tag-${tagSlug(majorOf(s))}`}>{labelOf(s)}</span>
                        ))}
                      </div>
                    )}
                    <ul className="history-list">
                      {(w.entries ?? []).map((e, i) => (
                        <li key={e.exercise_id ?? e.exercise?.id ?? i} className="history-ex">
                          <span className="history-ex-name">{e.exercise?.name ?? '—'}</span>
                          <span className="history-ex-sets">
                            {(e.sets ?? []).map((s) => fmtSet(exerciseMetric(e.exercise), s)).join(', ') || '—'}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="btn full cal-open" onClick={() => onOpen?.(w.id)}>
                      Открыть тренировку
                    </button>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </SheetDialog>
  )
}
