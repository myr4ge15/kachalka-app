import { useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getWorkouts } from '../db/repo.js'
import { dayTags, tagSlug, matchesGroup, availableGroups } from '../lib/dayTags.js'
import { exerciseMetric, fmtSet } from '../lib/metric.js'
import WorkoutScreen from './WorkoutScreen.jsx'
import TemplatesScreen from './TemplatesScreen.jsx'

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
  // Фильтр по группе мышц (null = «Все»). Чипы строим только из реально
  // встречающихся групп, чтобы не показывать пустые.
  const [filter, setFilter] = useState(null)
  const groups = useMemo(() => availableGroups(list), [list])
  const shown = useMemo(
    () => list.filter((w) => matchesGroup(w.entries, filter)),
    [list, filter]
  )

  if (selected === 'templates') {
    return <TemplatesScreen user={user} onBack={() => setSelected(null)} />
  }

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

      <button className="btn outline full tpl-link" onClick={() => setSelected('templates')}>
        📋 Шаблоны
      </button>

      {loading && <p className="muted">Загрузка…</p>}

      {!loading && list.length === 0 && (
        <p className="muted empty">Пока нет записанных тренировок.</p>
      )}

      {groups.length > 0 && (
        <div className="chips tag-filter">
          <button
            className={filter === null ? 'chip active' : 'chip'}
            onClick={() => setFilter(null)}
          >
            Все
          </button>
          {groups.map((g) => (
            <button
              key={g}
              className={filter === g ? 'chip active' : 'chip'}
              onClick={() => setFilter(filter === g ? null : g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {!loading && list.length > 0 && shown.length === 0 && (
        <p className="muted empty">Нет тренировок с группой «{filter}».</p>
      )}

      {shown.map((w) => {
        const { exCount, setCount } = summarize(w)
        const tags = dayTags(w.entries)
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

            {tags.length > 0 && (
              <div className="day-tags">
                {tags.map((g) => (
                  <span key={g} className={`day-tag tag-${tagSlug(g)}`}>{g}</span>
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
          </button>
        )
      })}
    </div>
  )
}
