import { useId, useState } from 'react'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import { trendLabel, WEEKS } from '../../lib/groupVolume.js'
import { fmtNum } from '../../lib/metric.js'
import { labelOf } from '../../lib/muscles.js'
import { plural } from '../../lib/plural.js'
import MenuRow from '../ui/MenuRow.jsx'

const cap = (s) => s[0].toUpperCase() + s.slice(1)

function WeeklySets({ count }) {
  const unit = Number.isInteger(count) ? plural(count, 'подход', 'подхода', 'подходов') : 'подхода'
  return <span className="gv-num"><b>{fmtNum(count)}</b> {unit}/нед.</span>
}

export default function GroupVolume({ rows }) {
  const id = useId()
  const [expanded, setExpanded] = useState(null)
  const revealRef = useRevealFocus(expanded)
  if (!rows?.length) return null
  const max = Math.max(1, ...rows.flatMap((row) => row.weeks))

  return (
    <section className="gv" aria-labelledby={id}>
      <h3 className="sec-title gv-title" id={id}>Объем по группам</h3>
      <p className="gv-sub muted">Рабочие подходы за {WEEKS} недели. Тренд сравнивает две последние недели с двумя предыдущими.</p>
      <ul className="gv-list">
        {rows.map((row, index) => {
          const panelId = `${id}-muscles-${index}`
          const open = expanded === row.group
          const summary = (
            <span className="gv-summary">
              <span className="gv-name">{cap(row.group)}</span>
              <span className="gv-bars" aria-hidden="true">
                {row.weeks.map((count, i) => (
                  <i key={i} className={i === row.weeks.length - 1 ? 'now' : ''} style={{ height: `${Math.max(8, (count / max) * 100)}%`, opacity: count ? 1 : 0.35 }} />
                ))}
              </span>
              <WeeklySets count={row.perWeek} />
              <span className={`gv-trend gv-trend--${row.trend}`}>{trendLabel(row)}</span>
            </span>
          )
          return (
            <li key={row.group} className="gv-row" ref={open ? revealRef : undefined}>
              {row.muscles.length ? (
                <>
                  <MenuRow className="gv-toggle" kind="expand" open={open} title={summary} aria-controls={panelId}
                    onClick={() => setExpanded((prev) => prev === row.group ? null : row.group)} />
                  <div className="gv-detail" id={panelId} hidden={!open}>
                    <p className="gv-detail-title">Основные мышцы · среднее за две недели</p>
                    <ul className="gv-muscles">
                      {row.muscles.map(({ submuscle, perWeek }) => (
                        <li key={submuscle ?? 'unassigned'}>
                          <span>{submuscle ? cap(labelOf(submuscle)) : 'Без уточнения мышцы'}</span>
                          <WeeklySets count={perWeek} />
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : <div className="gv-static">{summary}</div>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
