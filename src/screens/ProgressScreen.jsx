import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Dot,
} from 'recharts'
import { useLiveQuery } from 'dexie-react-hooks'
import { getWorkouts } from '../db/repo.js'
import { bestOneRepMax } from '../lib/oneRepMax.js'
import { cmpIsoAsc } from '../lib/cmp.js'

function fmtDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

function cssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function collectExercises(workouts) {
  const map = new Map()
  for (const w of workouts) {
    for (const e of w.entries ?? []) {
      const id = e.exercise?.id ?? e.exercise_id
      if (!id) continue
      const sets = e.sets ?? []
      if (sets.length === 0) continue
      const rec = map.get(id) ?? {
        id,
        name: e.exercise?.name ?? 'Упражнение',
        is_bench_lift: false,
        hasWeight: false,
      }
      if (e.exercise?.name) rec.name = e.exercise.name
      if (e.exercise?.is_bench_lift) rec.is_bench_lift = true
      if (sets.some((s) => Number(s.weight) > 0)) rec.hasWeight = true
      map.set(id, rec)
    }
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      Number(b.is_bench_lift) - Number(a.is_bench_lift) ||
      String(a.name).localeCompare(String(b.name), 'ru')
  )
}

function buildSeries(workouts, exerciseId, weighted) {
  const byDay = new Map()
  for (const w of workouts) {
    const day = String(w.performed_at ?? '').slice(0, 10)
    if (!day) continue
    for (const e of w.entries ?? []) {
      const id = e.exercise?.id ?? e.exercise_id
      if (id !== exerciseId) continue
      const sets = e.sets ?? []
      if (sets.length === 0) continue
      const rec = byDay.get(day) ?? { day, sets: [] }
      rec.sets.push(...sets)
      byDay.set(day, rec)
    }
  }
  const series = Array.from(byDay.values())
    .map((rec) => ({
      ...rec,
      value: weighted
        ? bestOneRepMax(rec.sets)
        : rec.sets.reduce((s, x) => s + (Number(x.reps) || 0), 0),
    }))
    .sort((a, b) => cmpIsoAsc(a.day, b.day))

  let running = 0
  let prev = null
  for (const p of series) {
    p.isPr = p.value > running
    if (p.isPr) running = p.value
    // Направление относительно предыдущей сессии: для подсветки прогресса/
    // регресса (ТЗ 4.2). Первая точка — старт, считаем «рост».
    p.dir = prev == null ? 'up' : p.value > prev ? 'up' : p.value < prev ? 'down' : 'flat'
    prev = p.value
  }
  return series
}

function fmtSet(s, weighted) {
  const reps = Number(s.reps) || 0
  const weight = Number(s.weight) || 0
  return weighted && weight > 0 ? `${s.weight}×${reps}` : `${reps}`
}

const PERIODS = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'all', label: 'Всё' },
  { id: 'custom', label: 'Период' },
]

// Границы периода как ISO-дни (YYYY-MM-DD) или null = без ограничения.
// ISO-строки сравниваются лексикографически, поэтому хватает строкового <,>.
function periodRange(period, from, to) {
  if (period === 'all') return null
  if (period === 'custom') return { from: from || null, to: to || null }
  const d = new Date()
  if (period === 'week') d.setDate(d.getDate() - 7)
  else if (period === 'month') d.setMonth(d.getMonth() - 1)
  return { from: d.toISOString().slice(0, 10), to: null }
}

function inRange(day, range) {
  if (!range) return true
  if (range.from && day < range.from) return false
  if (range.to && day > range.to) return false
  return true
}

export default function ProgressScreen({ user }) {
  const workouts = useLiveQuery(() => getWorkouts(user.id), [user.id])
  const loading = workouts === undefined

  const list = useMemo(() => collectExercises(workouts ?? []), [workouts])
  const [selId, setSelId] = useState(null)

  const selected = useMemo(() => {
    if (list.length === 0) return null
    const picked = selId != null && list.find((x) => String(x.id) === String(selId))
    return picked || list.find((x) => x.is_bench_lift) || list[0]
  }, [list, selId])

  const weighted = selected ? selected.hasWeight : true

  // PR и направление считаем по ВСЕЙ истории (рекорд — личный за всё время),
  // а период лишь сужает отображаемые точки. Поэтому строим ряд целиком и
  // фильтруем результат, а не входные тренировки.
  const [period, setPeriod] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const fullData = useMemo(
    () => (selected ? buildSeries(workouts ?? [], selected.id, weighted) : []),
    [workouts, selected, weighted]
  )
  const range = useMemo(() => periodRange(period, from, to), [period, from, to])
  const data = useMemo(() => fullData.filter((p) => inRange(p.day, range)), [fullData, range])
  const rows = useMemo(() => [...data].reverse(), [data])

  const best = data.reduce((m, p) => Math.max(m, p.value), 0)
  // Лучший ФАКТИЧЕСКИЙ вес за период (самый тяжёлый реально поднятый подход).
  const bestWeight = weighted
    ? data.reduce((m, p) => {
        for (const s of p.sets) {
          const wt = Number(s.weight) || 0
          if (wt > m) m = wt
        }
        return m
      }, 0)
    : 0
  const unit = weighted ? 'кг' : 'повт.'
  const metricLabel = weighted ? '1ПМ' : 'Σ повторов'

  const c = useMemo(() => ({
    grid: cssVar('--surface', '#1e293b'),
    axis: cssVar('--muted', '#94a3b8'),
    line: cssVar('--green', '#16a34a'),
    down: cssVar('--red', '#ef4444'),
    flat: cssVar('--muted', '#94a3b8'),
    pr: cssVar('--yellow', '#facc15'),
    bg: cssVar('--bg', '#0f172a'),
    border: cssVar('--border', '#334155'),
    text: cssVar('--text', '#e2e8f0'),
  }), [])

  // Цвет точки по смыслу: рекорд > спад/рост. Жёлтый — новый максимум,
  // зелёный — рост к прошлой сессии, красный — спад, серый — без изменений.
  const dotColor = (p) =>
    p.isPr ? c.pr : p.dir === 'down' ? c.down : p.dir === 'flat' ? c.flat : c.line

  // Линию красим посегментно через градиент по оси X: каждый сегмент — своим
  // цветом (рост зелёный / спад красный) с резкой границей (две стоп-точки на
  // одном офсете). При одной точке линии нет — берём сплошной зелёный.
  const gradId = 'progDir'
  const stops = useMemo(() => {
    const n = data.length
    if (n < 2) return []
    const out = []
    for (let i = 0; i < n - 1; i++) {
      const col = data[i + 1].dir === 'down' ? c.down : c.line
      const o1 = (i / (n - 1)) * 100
      const o2 = ((i + 1) / (n - 1)) * 100
      out.push({ off: o1, col }, { off: o2, col })
    }
    return out
  }, [data, c])
  const lineStroke = data.length >= 2 ? `url(#${gradId})` : c.line

  return (
    <div className="screen">
      <h2 className="screen-title">Прогресс</h2>
      <p className="muted sub">
        {weighted
          ? 'Расчётный максимум на раз (1ПМ, формула Эпли)'
          : 'Упражнение без веса — динамика по суммарным повторам'}
      </p>

      {loading && <p className="muted">Загрузка…</p>}

      {!loading && list.length === 0 && (
        <p className="muted empty">Пока нет данных. Запиши тренировку.</p>
      )}

      {!loading && list.length > 0 && selected && (
        <>
          <label className="prog-pick">
            <span className="muted">Упражнение</span>
            <select
              className="prog-select"
              value={String(selected.id)}
              onChange={(e) => setSelId(e.target.value)}
            >
              {list.map((x) => (
                <option key={x.id} value={String(x.id)}>
                  {x.name}{x.is_bench_lift ? ' ⭐' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="prog-periods">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                className={`prog-chip${period === p.id ? ' active' : ''}`}
                onClick={() => setPeriod(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {period === 'custom' && (
            <div className="prog-range">
              <label>
                <span>С</span>
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                <span>По</span>
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          )}

          {data.length === 0 ? (
            <p className="muted empty">
              {fullData.length > 0
                ? 'Нет подходов за выбранный период.'
                : 'Нет подходов по этому упражнению.'}
            </p>
          ) : (
            <>
              <div className="card stat">
                {weighted ? (
                  <>
                    <span className="stat-num">{bestWeight} кг</span>
                    <span className="muted">лучший фактический вес</span>
                    <span className="muted stat-sub">в теории (1ПМ) ~{best} кг</span>
                  </>
                ) : (
                  <>
                    <span className="stat-num">{best} {unit}</span>
                    <span className="muted">макс. повторов за день</span>
                  </>
                )}
              </div>

              <div className="card chart-card">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
                        {stops.map((s, idx) => (
                          <stop key={idx} offset={`${s.off}%`} stopColor={s.col} />
                        ))}
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                    <XAxis dataKey="day" tickFormatter={fmtDate} stroke={c.axis} fontSize={12} />
                    <YAxis
                      stroke={c.axis}
                      fontSize={12}
                      domain={weighted ? ['dataMin - 5', 'dataMax + 5'] : [0, 'dataMax + 2']}
                    />
                    <Tooltip
                      labelFormatter={(v) => fmtDate(v)}
                      formatter={(v) => [`${v} ${unit}`, metricLabel]}
                      contentStyle={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8 }}
                      labelStyle={{ color: c.text }}
                    />
                    <Line
                      type="monotone" dataKey="value" stroke={lineStroke} strokeWidth={2}
                      dot={(props) => {
                        const { cx, cy, payload } = props
                        return (
                          <Dot
                            cx={cx} cy={cy} r={payload.isPr ? 5 : 3}
                            fill={dotColor(payload)}
                            stroke={c.bg}
                          />
                        )
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <p className="muted legend">● зелёный — рост · ● красный — спад · ● жёлтый — новый рекорд</p>
              </div>

              <div className="card prog-card">
                <h3 className="prog-table-title">По дням</h3>
                <div className="prog-table">
                  <div className="prog-row prog-row-head">
                    <span>Дата</span>
                    <span>Подходы ({weighted ? 'кг×повт.' : 'повт.'})</span>
                    <span className="prog-val">{metricLabel}</span>
                  </div>
                  {rows.map((r) => (
                    <div key={r.day} className={`prog-row${r.isPr ? ' pr' : ''}`}>
                      <span>{fmtDate(r.day)}</span>
                      <span className="prog-sets">
                        {r.sets.map((s) => fmtSet(s, weighted)).join(', ')}
                      </span>
                      <span className="prog-val">
                        {r.value}{r.isPr ? ' 🏆' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {weighted && (
                <p className="formula-note">
                  1ПМ считается по формуле Эпли:{' '}
                  <code>вес × (1 + повторы ÷ 30)</code>. Это расчётная оценка
                  максимума «на раз», а не результат реального теста — чем больше
                  повторов в подходе, тем выше погрешность.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
