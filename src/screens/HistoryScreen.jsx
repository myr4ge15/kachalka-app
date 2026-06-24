import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getWorkouts } from '../db/repo.js'
import WorkoutScreen from './WorkoutScreen.jsx'

function fmtDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

function summarize(w) {
  const entries = w.entries ?? []
  const exCount = entries.length
  const setCount = entries.reduce((n, e) => n + (e.sets?.length ?? 0), 0)
  return { exCount, setCount }
}

// Хаб «Мои тренировки»: список тренировок + вход в композер/деталь.
//   selected === null → список
//   selected === 'new' → новая тренировка
//   selected === <id>  → деталь существующей
export default function HistoryScreen({ user }) {
  const workouts = useLiveQuery(() => getWorkouts(user.id), [user.id])
  const loading = workouts === undefined
  const list = workouts ?? []

  const [selected, setSelected] = useState(null)

  if (selected !== null) {
    return (
      <WorkoutScreen
        user={user}
        workoutId={selected === 'new' ? null : selected}
        onBack={() => setSelected(null)}
      />
    )
  }

  return (
    <div className="screen">
      <h2 className="screen-title">Мои тренировки</h2>

      <button className="btn primary full add-workout" onClick={() => setSelected('new')}>
        + Добавить тренировку
      </button>

      {loading && <p className="muted">Загрузка…</p>}

      {!loading && list.length === 0 && (
        <p className="muted empty">Пока нет записанных тренировок.</p>
      )}

      {list.map((w) => {
        const { exCount, setCount } = summarize(w)
        const unsynced = Boolean(w._dirty)
        return (
          <button key={w.id} className="card history-card history-tap" onClick={() => setSelected(w.id)}>
            <div className="history-head">
              <div>
                <div className="history-date">
                  {fmtDate(w.performed_at)}
                  {unsynced && <span className="dot-unsynced" title="Ждёт синхронизации">●</span>}
                </div>
                <div className="muted history-sub">
                  {exCount} упр · {setCount} подх.
                </div>
              </div>
              <span className="history-chevron" aria-hidden="true">›</span>
            </div>

            <ul className="history-list">
              {(w.entries ?? []).map((e, i) => (
                <li key={i} className="history-ex">
                  <span className="history-ex-name">{e.exercise?.name ?? '—'}</span>
                  <span className="history-ex-sets">
                    {(e.sets ?? []).map((s) => `${s.weight}×${s.reps}`).join(', ') || '—'}
                  </span>
                </li>
              ))}
            </ul>
          </button>
        )
      })}
    </div>
  )
}
