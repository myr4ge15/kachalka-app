import { useState, useEffect } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Dot,
} from 'recharts'
import { supabase } from '../db/supabase.js'
import { bestOneRepMax } from '../lib/oneRepMax.js'

function fmtDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

export default function ProgressScreen({ user }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      try {
        // 1) упражнение для графика — жим лёжа
        const { data: bench, error: be } = await supabase
          .from('exercises')
          .select('id, name')
          .eq('is_bench_lift', true)
          .limit(1)
          .single()
        if (be) throw be

        // 2) все подходы пользователя в жиме, с датой тренировки
        const { data: rows, error: re } = await supabase
          .from('workout_exercises')
          .select('workouts!inner(performed_at, user_id), sets(weight, reps)')
          .eq('exercise_id', bench.id)
          .eq('workouts.user_id', user.id)
        if (re) throw re

        // 3) лучший 1ПМ за каждый день
        const byDay = new Map()
        for (const r of rows ?? []) {
          const sets = r.sets ?? []
          if (sets.length === 0) continue
          const orm = bestOneRepMax(sets)
          const day = (r.workouts.performed_at ?? '').slice(0, 10)
          byDay.set(day, Math.max(byDay.get(day) ?? 0, orm))
        }

        const series = Array.from(byDay.entries())
          .map(([day, orm]) => ({ day, orm }))
          .sort((a, b) => a.day.localeCompare(b.day))

        // отметка рекордов (новый максимум по ходу истории)
        let running = 0
        for (const p of series) {
          p.isPr = p.orm > running
          if (p.isPr) running = p.orm
        }

        setData(series)
      } catch (err) {
        setError('Не удалось загрузить прогресс: ' + (err.message ?? err))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user.id])

  const best = data.reduce((m, p) => Math.max(m, p.orm), 0)

  return (
    <div className="screen">
      <h2 className="screen-title">Прогресс — жим лёжа</h2>
      <p className="muted sub">Расчётный максимум на раз (1ПМ, формула Эпли)</p>

      {loading && <p className="muted">Загрузка…</p>}
      {error && <div className="banner error">{error}</div>}

      {!loading && !error && data.length === 0 && (
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
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="day" tickFormatter={fmtDate} stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} domain={['dataMin - 5', 'dataMax + 5']} />
                <Tooltip
                  labelFormatter={(v) => fmtDate(v)}
                  formatter={(v) => [`${v} кг`, '1ПМ']}
                  contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                  labelStyle={{ color: '#e2e8f0' }}
                />
                <Line
                  type="monotone" dataKey="orm" stroke="#16a34a" strokeWidth={2}
                  dot={(props) => {
                    const { cx, cy, payload } = props
                    return (
                      <Dot
                        cx={cx} cy={cy} r={payload.isPr ? 5 : 3}
                        fill={payload.isPr ? '#facc15' : '#16a34a'}
                        stroke="#0f172a"
                      />
                    )
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
            <p className="muted legend">● зелёный — сессия · ● жёлтый — новый рекорд</p>
          </div>
        </>
      )}
    </div>
  )
}
