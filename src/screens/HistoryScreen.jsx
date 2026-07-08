import { useState, useMemo, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getWorkouts } from '../db/repo.js'
import { dayTags, tagSlug, matchesGroup, availableGroups } from '../lib/dayTags.js'
import { exerciseMetric, fmtSet } from '../lib/metric.js'
import { exportWorkouts } from '../lib/exportWorkout.js'
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

  // Режим экспорта: мультивыбор тренировок из списка → выгрузка в JSON.
  const [selectMode, setSelectMode] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  function toggleSelectMode() {
    setSelectMode((on) => !on)
    setPicked(new Set())
  }
  function togglePick(id) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function pickAll() {
    setPicked(new Set(shown.map((w) => w.id)))
  }
  function exportPicked() {
    const chosen = list.filter((w) => picked.has(w.id))
    if (!chosen.length) return
    const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
    exportWorkouts(chosen, appVersion)
    setSelectMode(false)
    setPicked(new Set())
  }

  // Вход в редактор/деталь и возврат к списку должны начинаться с верха страницы.
  // Скроллится не окно, а внешняя .content (overflow-y:auto, см. App.jsx/index.css);
  // при смене под-вида внутри хаба её позиция не сбрасывалась — после «Сохранить»
  // (кнопка внизу редактора) пользователь возвращался к списку, прокрученному вниз.
  useEffect(() => {
    document.querySelector('.content')?.scrollTo({ top: 0 })
  }, [selected])

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
          <button
            key={w.id}
            className={'card history-card history-tap' + (selectMode && picked.has(w.id) ? ' picked' : '')}
            onClick={() => (selectMode ? togglePick(w.id) : setSelected(w.id))}
          >
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
              {selectMode ? (
                <span className={'history-check' + (picked.has(w.id) ? ' on' : '')} aria-hidden="true">
                  {picked.has(w.id) ? '✓' : ''}
                </span>
              ) : (
                <span className="history-chevron" aria-hidden="true">›</span>
              )}
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

      {/* Экспорт уведён из верхнего слота под список, чтобы верх занимали фильтры.
          Вне режима выбора — приглушённая ссылка внизу; в режиме выбора — фиксир.
          бар над таббаром, чтобы счётчик/«Скачать» были видны при прокрутке. */}
      {!loading && list.length > 0 && !selectMode && (
        <button className="link-btn export-toggle export-toggle--bottom" onClick={toggleSelectMode}>
          ⬇ Экспорт тренировок
        </button>
      )}

      {selectMode && (
        <>
          <div className="wk-save-spacer" aria-hidden="true" />
          <div className="export-bar export-bar--fixed">
            <span className="muted">Выбрано: {picked.size}</span>
            <div className="export-bar-actions">
              <button className="link-btn" onClick={pickAll}>Все</button>
              <button className="link-btn" onClick={toggleSelectMode}>Отмена</button>
              <button className="btn primary" disabled={picked.size === 0} onClick={exportPicked}>
                ⬇ Скачать{picked.size ? ` (${picked.size})` : ''}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
