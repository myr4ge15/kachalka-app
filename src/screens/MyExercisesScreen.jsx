import { useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCustomExercises, updateExercise } from '../db/repo.js'
import { submusclesOf, secondaryOptionsFor, labelOf, majorOf, defaultSubmuscleFor } from '../lib/muscles.js'
import CardsSkeleton from '../components/CardsSkeleton.jsx'

// Экран «Мои упражнения» (виш BACKLOG): список добавленных пользователями
// (is_custom) упражнений с возможностью редактировать их — название, тип метрики,
// группу мышц, основную/вторичные подмышцы. Правка идёт офлайн-first через
// repo.updateExercise (локальный кэш + ре-upsert в ex_outbox); сидовый справочник
// сюда не попадает (его правит админ). Форма редактирования повторяет форму
// создания своего упражнения из ExercisePicker.
//
// Пропсы: onBack(). (Пользователь не нужен: справочник своих упражнений читается
// из уже персональной базы, см. repo.getCustomExercises.)

const BASE_GROUPS = ['грудь', 'спина', 'ноги', 'плечи', 'бицепс', 'трицепс', 'пресс', 'кардио']
const METRIC_LABEL = { weight: 'вес и повторы', reps: 'только повторы', time: 'на время' }

export default function MyExercisesScreen({ onBack }) {
  const list = useLiveQuery(() => getCustomExercises(), [])
  const loading = list === undefined

  // Редактируемое упражнение (null → список).
  const [editing, setEditing] = useState(null)

  // Группы для формы: канон из ТЗ + всё, что реально встретилось в справочнике.
  const createGroups = useMemo(() => {
    const set = new Set(BASE_GROUPS)
    for (const e of list ?? []) if (e.muscle_group) set.add(e.muscle_group)
    return Array.from(set)
  }, [list])

  if (editing) {
    return (
      <EditForm
        ex={editing}
        groups={createGroups}
        onCancel={() => setEditing(null)}
        onSaved={() => setEditing(null)}
      />
    )
  }

  return (
    <div className="screen">
      <div className="admin-head">
        <button className="admin-back" onClick={onBack}>‹ Назад</button>
        <h2 className="admin-title">Мои упражнения</h2>
      </div>

      {loading ? (
        <CardsSkeleton cards={4} />
      ) : list.length === 0 ? (
        <p className="muted empty">
          Здесь появятся упражнения, которые вы добавили сами. Создать своё можно при
          добавлении упражнения в тренировку («+ добавить своё упражнение»).
        </p>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: 10 }}>
            Упражнения, добавленные вами. Изменения увидят все участники.
          </p>
          <div className="picker-list">
            {list.map((e) => (
              <button key={e.id} className="picker-item" onClick={() => setEditing(e)}>
                <span>
                  {e.name}
                  <span className="picker-group" style={{ display: 'block' }}>
                    {METRIC_LABEL[e.metric] ?? 'вес и повторы'}
                  </span>
                </span>
                <span className="picker-group">{e.muscle_group ?? '—'} ✎</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Форма редактирования одного упражнения. Начальные значения — из ex.
function EditForm({ ex, groups, onCancel, onSaved }) {
  const [name, setName] = useState(ex.name ?? '')
  const [group, setGroup] = useState(ex.muscle_group ?? '')
  const [sub, setSub] = useState(ex.submuscle ?? defaultSubmuscleFor(ex.muscle_group) ?? '')
  const [secondary, setSecondary] = useState(Array.isArray(ex.secondary) ? ex.secondary : [])
  const [metric, setMetric] = useState(ex.metric ?? 'weight')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Смена группы: подмышку сбрасываем на дефолт группы, вторичные чистим.
  function pickGroup(g) {
    setGroup(g)
    setSub(defaultSubmuscleFor(g) ?? '')
    setSecondary([])
  }

  async function submit() {
    const clean = name.trim()
    if (!clean) { setError('Введите название упражнения.'); return }
    if (!group) { setError('Выберите группу мышц.'); return }
    setBusy(true)
    setError(null)
    try {
      await updateExercise({ id: ex.id, name: clean, muscle_group: group, metric, submuscle: sub, secondary })
      onSaved()
    } catch (err) {
      setError('Не удалось сохранить: ' + (err?.message ?? err))
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <div className="admin-head">
        <button className="admin-back" onClick={onCancel}>‹ Назад</button>
        <h2 className="admin-title">Упражнение</h2>
      </div>

      <input
        className="search"
        placeholder="Название упражнения"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />

      <div className="create-label">Тип</div>
      <div className="chips">
        <button className={metric === 'weight' ? 'chip active' : 'chip'} onClick={() => setMetric('weight')}>Вес и повторы</button>
        <button className={metric === 'reps' ? 'chip active' : 'chip'} onClick={() => setMetric('reps')}>Только повторы</button>
        <button className={metric === 'time' ? 'chip active' : 'chip'} onClick={() => setMetric('time')}>На время</button>
      </div>

      <div className="create-label">Группа мышц</div>
      <div className="chips">
        {groups.map((g) => (
          <button key={g} className={g === group ? 'chip active' : 'chip'} onClick={() => pickGroup(g)}>{g}</button>
        ))}
      </div>

      {submusclesOf(group).length > 0 && (
        <>
          <div className="create-label">Основная мышца</div>
          <div className="chips">
            {submusclesOf(group).map((s) => (
              <button
                key={s}
                className={s === sub ? 'chip active' : 'chip'}
                onClick={() => {
                  setSub(s)
                  setSecondary((sec) => sec.filter((x) => x !== s))
                }}
              >
                {labelOf(s)}
              </button>
            ))}
          </div>
        </>
      )}

      {sub && (
        <>
          <div className="create-label">Вторичные мышцы <span className="muted">(необязательно)</span></div>
          <div className="chips wrap">
            {secondaryOptionsFor(sub).map((s) => {
              const on = secondary.includes(s)
              return (
                <button
                  key={s}
                  className={on ? 'chip active' : 'chip'}
                  onClick={() => setSecondary((sec) => (on ? sec.filter((x) => x !== s) : [...sec, s]))}
                >
                  {labelOf(s)}<span className="chip-major"> · {majorOf(s)}</span>
                </button>
              )
            })}
          </div>
        </>
      )}

      {error && <p className="error create-error">{error}</p>}

      <button className="btn primary full create-save" disabled={busy} onClick={submit}>
        {busy ? 'Сохранение…' : 'Сохранить'}
      </button>
    </div>
  )
}
