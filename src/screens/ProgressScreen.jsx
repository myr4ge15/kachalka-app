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
  for (const p of series) {
    p.isPr = p.value > running
    if (p.isPr) running = p.value
  }
  return series
}

function fmtSet(s, weighted) {
  const reps = Number(s.reps) || 0
  const weight = Number(s.weight) || 0
  return weighted && weight > 0 ? `${s.weight}×${reps}` : `${reps}`
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
  const data = useMemo(
    () => (selected ? buildSeries(workouts ?? [], selected.id, weighted) : []),
    [workouts, selected, weighted]
  )
  const rows = useMemo(() => [...data].reverse(), [data])

  const best = data.reduce((m, p) => Math.max(m, p.value), 0)
  const unit = weighted ? 'кг' : 'повт.'
  const metricLabel = weighted ? '1ПМ' : 'Σ повторов'

  const c = useMemo(() => ({
    grid: cssVar('--surface', '#1e293b'),
    axis: cssVar('--muted', '#94a3b8'),
    line: cssVar('--green', '#16a34a'),
    pr: cssVar('--yellow', '#facc15'),
    bg: cssVar('--bg', '#0f172a'),
    border: cssVar('--border', '#334155'),
    text: cssVar('--text', '#e2e8f0'),
  }), [])

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

          {data.length === 0 ? (
            <p className="muted empty">Нет подходов по этому упражнению.</p>
          ) : (
            <>
              <div className="card stat">
                <span className="stat-num">{best} {unit}</span>
                <span className="muted">{weighted ? 'лучший 1ПМ' : 'макс. повторов за день'}</span>
              </div>

              <div className="card chart-card">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
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
                      type="monotone" dataKey="value" stroke={c.line} strokeWidth={2}
                      dot={(props) => {
                        const { cx, cy, payload } = props
                        return (
                          <Dot
                            cx={cx} cy={cy} r={payload.isPr ? 5 : 3}
                            fill={payload.isPr ? c.pr : c.line}
                            stroke={c.bg}
                          />
                        )
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <p className="muted legend">● зелёный — сессия · ● жёлтый — новый рекорд</p>
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
