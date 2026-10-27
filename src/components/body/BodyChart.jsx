import { useLayoutEffect, useRef, useState } from 'react'
import { niceScale } from '../../lib/chartScale.js'
import { daysBetween } from '../../lib/body.js'
import { toDate } from '../../lib/calendar.js'

// График веса (PLAN-body-metrics.md): точки — взвешивания (бледно), линия — тренд 7 дней,
// пунктир — цель. Свой SVG, а не Recharts: точек мало, а в режиме «Скрыть цифры» нужно
// убрать ВСЕ числа (ось, подсказку, подпись цели) — проще не рисовать их вовсе.
// Цвета — классы из index.css (.bc-*), не инлайн. Пропсы:
//   days [{date, weight}], trend [{date, value}] — уже обрезаны по периоду, от старых к новым;
//   goal — {target}|null; hide — без оси и подписи цели.
// Тап или ведение пальцем (fb_5a1ecb11) — ближайшее взвешивание: дата, вес и тренд в подсказке сверху.
// При «Скрыть цифры» подсказка — только дата. Блок с data-no-swipe-back: ведение пальцем вбок —
// жест графика, а не «назад» (lib/screenNav.js swipeBackBlocked).
// Ширина — по контейнеру (ResizeObserver), высота постоянная: на десктопе viewBox раздувал
// подписи до 20 px (fb_7934761f). Подписи всегда 10 px.
const W0 = 330
const H = 190
const T = 10
const B = 22

const short = (ymd) => toDate(ymd).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')

export default function BodyChart({ days, trend, goal = null, hide = false }) {
  const boxRef = useRef(null)
  const [W, setW] = useState(W0)
  const [sel, setSel] = useState(null) // индекс выбранного взвешивания
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width)
      if (w > 0) setW(Math.max(260, Math.min(1000, w)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  if (!days.length) return null
  const L = hide ? 8 : 34
  const R = 8
  const first = days[0].date
  const last = days[days.length - 1].date
  const span = Math.max(1, daysBetween(first, last))
  const vals = [...days.map((d) => d.weight), ...(goal ? [goal.target] : [])]
  const scale = niceScale(vals, { pad: 0.5, maxTicks: 5 })
  const [lo, hi] = scale.domain
  const x = (ymd) => L + ((W - L - R) * daysBetween(first, ymd)) / span
  const y = (v) => T + ((H - T - B) * (hi - v)) / (hi - lo || 1)
  const path = trend.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ')
  const end = trend[trend.length - 1]
  const mid = days.length > 2 ? days[Math.floor(days.length / 2)].date : null
  const pick = (e) => {
    const svg = e.currentTarget
    const r = svg.getBoundingClientRect()
    if (!r.width) return
    const px = ((e.clientX - r.left) / r.width) * W
    let best = 0
    for (let i = 1; i < days.length; i++) if (Math.abs(x(days[i].date) - px) < Math.abs(x(days[best].date) - px)) best = i
    setSel(best)
  }
  const cur = sel != null && days[sel] ? days[sel] : null
  const curTrend = cur ? trend.find((p) => p.date === cur.date) : null
  const tip = cur
    ? (hide ? short(cur.date) : `${short(cur.date)} · ${cur.weight} кг${curTrend && Math.abs(curTrend.value - cur.weight) >= 0.05 ? ` · тренд ${Math.round(curTrend.value * 10) / 10}` : ''}`)
    : ''
  const tipW = tip.length * 6.2 + 16
  const tipX = cur ? Math.min(W - R - tipW, Math.max(L, x(cur.date) - tipW / 2)) : 0

  return (
    <div ref={boxRef} className="body-chart-box" data-no-swipe-back>
    <svg className="body-chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
      onPointerDown={pick} onPointerMove={(e) => { if (e.buttons || e.pointerType === 'mouse') pick(e) }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setSel(null) }}
      aria-label={hide ? 'График веса: направление без цифр' : 'График веса за период'}>
      {!hide && scale.ticks.map((t) => (
        <g key={t}>
          <line className="bc-grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
          <text className="bc-axis" x={L - 6} y={y(t) + 4} textAnchor="end">{t}</text>
        </g>
      ))}
      {goal && (
        <g>
          <line className="bc-goal" x1={L} x2={W - R} y1={y(goal.target)} y2={y(goal.target)} />
          {/* Подпись слева: справа конец линии тренда, и «цель 70» на нее наезжала. */}
          {!hide && <text className="bc-goal-lbl" x={L + 4} y={y(goal.target) - 5}>цель {goal.target}</text>}
        </g>
      )}
      {days.map((d) => <circle key={d.date} className="bc-dot" cx={x(d.date)} cy={y(d.weight)} r="3" />)}
      {trend.length > 1 && <path className="bc-trend" d={path} />}
      {end && <circle className="bc-end" cx={x(end.date)} cy={y(end.value)} r="4.5" />}
      {cur && (
        <g className="bc-sel" aria-hidden="true">
          <line className="bc-sel-line" x1={x(cur.date)} x2={x(cur.date)} y1={T} y2={H - B} />
          <circle className="bc-sel-dot" cx={x(cur.date)} cy={y(cur.weight)} r="5" />
          <rect className="bc-tip" x={tipX} y={0} width={tipW} height={20} rx="6" />
          <text className="bc-tip-txt" x={tipX + tipW / 2} y={14} textAnchor="middle">{tip}</text>
        </g>
      )}
      <text className="bc-axis" x={L} y={H - 5}>{short(first)}</text>
      {mid && span > 20 && <text className="bc-axis" x={x(mid)} y={H - 5} textAnchor="middle">{short(mid)}</text>}
      {last !== first && <text className="bc-axis" x={W - R} y={H - 5} textAnchor="end">{short(last)}</text>}
    </svg>
    </div>
  )
}
