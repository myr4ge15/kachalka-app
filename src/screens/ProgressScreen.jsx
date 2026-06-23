import { useMemo } from 'react'
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

// Цвета графика берём из CSS-переменных темы (recharts требует конкретные
// значения в атрибутах SVG, var(...) там не резолвится) с запасным фолбэком.
function cssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

// Из локальных тренировок строим серию «лучший 1ПМ в жиме лёжа по дням».
// Считаем прямо на клиенте из денормализованных документов — поэтому график
// работает офлайн и сразу учитывает несинхронизированные записи.
function buildSeries(workouts) {
  const byDay = new Map()
  for (const w of workouts) {
    const day = String(w.performed_at ?? '').slice(0, 10)
    if (!day) continue
    for (const e of w.entries ?? []) {
      if (!e.exercise?.is_bench_lift) continue
      const sets = e.sets ?? []
      if (sets.length === 0) continue
      const orm = bestOneRepMax(sets)
      byDay.set(day, Math.max(byDay.get(day) ?? 0, orm))
    }
  }
  const series = Array.from(byDay.entries())
    .map(([day, orm]) => ({ day, orm }))
    .sort((a, b) => cmpIsoAsc(a.day, b.day))

  // отметка рекордов (новый максимум по ходу истории)
  let running = 0
  for (const p of series) {
    p.isPr = p.orm > running
    if (p.isPr) running = p.orm
  }
  return series
}

export default function ProgressScreen({ user }) {
  const workouts = useLiveQuery(() => getWorkouts(user.id), [user.id])
  const loading = workouts === undefined
  const data = useMemo(() => buildSeries(workouts ?? []), [workouts])

  const best = data.reduce((m, p) => Math.max(m, p.orm), 0)

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
      <h2 className="screen-title">Прогресс — жим лёжа</h2>
      <p className="muted sub">Расчётный максимум на раз (1ПМ, формула Эпли)</p>

      {loading && <p className="muted">Загрузка…</p>}

      {!loading && data.length === 0 && (
        <p className="muted empty">Пока нет данных по жиму. Запиши тренировку.</p>
      )}

      {!loading && data.length > 0 && (
        <>
          <div className="card stat">
            <span className="stat-num">{best} кг</span>
            <span className="muted">лучший 1ПМ</span>
          </div>

          <div className="card chart-card">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                <XAxis dataKey="day" tickFormatter={fmtDate} stroke={c.axis} fontSize={12} />
                <YAxis stroke={c.axis} fontSize={12} domain={['dataMin - 5', 'dataMax + 5']} />
                <Tooltip
                  labelFormatter={(v) => fmtDate(v)}
                  formatter={(v) => [`${v} кг`, '1ПМ']}
                  contentStyle={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8 }}
                  labelStyle={{ color: c.text }}
                />
                <Line
                  type="monotone" dataKey="orm" stroke={c.line} strokeWidth={2}
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

          <p className="formula-note">
            1ПМ считается по формуле Эпли:{' '}
            <code>вес × (1 + повторы ÷ 30)</code>. Это расчётная оценка
            максимума «на раз», а не результат реального теста — чем больше
            повторов в подходе, тем выше погрешность.
          </p>
        </>
      )}
    </div>
  )
}
