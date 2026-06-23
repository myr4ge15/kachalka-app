import { useState, useMemo } from 'react'

// Подбор упражнения из справочника: поиск по названию + фильтр по группе.
// Добавление пользовательских упражнений — следующий проход (см. ТЗ 4.4).
export default function ExercisePicker({ exercises, onPick, onClose }) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('все')

  const groups = useMemo(() => {
    const set = new Set(exercises.map((e) => e.muscle_group).filter(Boolean))
    return ['все', ...Array.from(set)]
  }, [exercises])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return exercises.filter((e) => {
      const okGroup = group === 'все' || e.muscle_group === group
      const okQuery = !q || e.name.toLowerCase().includes(q)
      return okGroup && okQuery
    })
  }, [exercises, query, group])

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <strong>Упражнение</strong>
          <button className="link-btn" onClick={onClose}>закрыть</button>
        </div>

        <input
          className="search"
          placeholder="Поиск по названию…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        <div className="chips">
          {groups.map((g) => (
            <button
              key={g}
              className={g === group ? 'chip active' : 'chip'}
              onClick={() => setGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>

        <div className="picker-list">
          {filtered.map((e) => (
            <button key={e.id} className="picker-item" onClick={() => onPick(e)}>
              <span>{e.name}</span>
              <span className="picker-group">{e.muscle_group}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="muted">Ничего не найдено.</p>}
        </div>
      </div>
    </div>
  )
}
