import { useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCustomExercises, updateExercise } from '../db/repo.js'
import { submusclesOf, secondaryOptionsFor, labelOf, majorOf, defaultSubmuscleFor } from '../lib/muscles.js'
import { splitCatalog, canEditExercise } from '../lib/exerciseCatalog.js'
import CardsSkeleton from '../components/CardsSkeleton.jsx'

// Экран «Каталог упражнений»: всё, что участники круга добавили сами (is_custom),
// разложенное на «Добавил я» и «Добавили другие» по owner_id.
//
// Раньше экран назывался «Мои упражнения» и показывал ВЕСЬ список кастомных
// упражнений круга под заголовком «упражнения, добавленные вами»: колонки
// владельца в базе не существовало, и у двух разных людей списки совпадали до
// строки. Владелец появился в v5.14.0 (supabase/exercise-owner.sql), и вместе с
// ним — честное название: справочник ОБЩИЙ, «мои» — это раздел внутри него, а не
// весь экран. Правится только своё и ничьё (легаси без владельца), см.
// lib/exerciseCatalog.js canEditExercise — то же правило стоит и в RLS.
//
// Пропсы: user (нужен для owner_id), onBack().

const BASE_GROUPS = ['грудь', 'спина', 'ноги', 'плечи', 'бицепс', 'трицепс', 'пресс', 'кардио']
const METRIC_LABEL = { weight: 'вес и повторы', reps: 'только повторы', time: 'на время' }

export default function MyExercisesScreen({ user, onBack }) {
  const list = useLiveQuery(() => getCustomExercises(), [])
  const loading = list === undefined

  // Редактируемое упражнение (null → список).
  const [editing, setEditing] = useState(null)

  const { mine, others } = useMemo(() => splitCatalog(list ?? [], user?.id), [list, user?.id])

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
        editorId={user?.id}
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
        <h2 className="admin-title">Каталог упражнений</h2>
      </div>

      {loading ? (
        <CardsSkeleton cards={4} />
      ) : list.length === 0 ? (
        <p className="muted empty">
          Здесь появятся упражнения, которые участники добавили сами. Создать своё
          можно при добавлении упражнения в тренировку («+ добавить своё упражнение»).
        </p>
      ) : (
        <>
          <p className="muted sub">
            Упражнения, добавленные участниками. Справочник общий: править можно
            только свои, изменения увидят все.
          </p>

          <Section
            title="Добавил я"
            list={mine}
            userId={user?.id}
            onEdit={setEditing}
            empty="Ты пока не добавлял своих упражнений."
          />
          <Section
            title="Добавили другие"
            list={others}
            userId={user?.id}
            onEdit={setEditing}
            empty="Пока только твои."
          />
        </>
      )}
    </div>
  )
}

// Раздел каталога. Чужие строки показываем, но не делаем кнопкой: тап, который
// открывает форму и упирается в ошибку сохранения, хуже, чем честно неактивная
// строка. Ничьи (owner_id пуст) правятся — они и лежат в «Добавили другие».
function Section({ title, list, userId, onEdit, empty }) {
  return (
    <>
      <div className="create-label">{title} <span className="muted">· {list.length}</span></div>
      {list.length === 0 ? (
        <p className="muted catalog-empty">{empty}</p>
      ) : (
        <div className="picker-list">
          {list.map((e) => {
            const editable = canEditExercise(e, userId)
            const body = (
              <span>
                {e.name}
                <span className="picker-group" style={{ display: 'block' }}>
                  {METRIC_LABEL[e.metric] ?? 'вес и повторы'}
                </span>
              </span>
            )
            return editable ? (
              <button key={e.id} className="picker-item" onClick={() => onEdit(e)}>
                {body}
                <span className="picker-group">{e.muscle_group ?? '—'} ✎</span>
              </button>
            ) : (
              <div key={e.id} className="picker-item is-static">
                {body}
                <span className="picker-group">{e.muscle_group ?? '—'}</span>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// Форма редактирования одного упражнения. Начальные значения — из ex.
function EditForm({ ex, editorId, groups, onCancel, onSaved }) {
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
    if (!clean) { setError('Введи название упражнения.'); return }
    if (!group) { setError('Выбери группу мышц.'); return }
    setBusy(true)
    setError(null)
    try {
      await updateExercise({
        id: ex.id, name: clean, muscle_group: group, metric, submuscle: sub, secondary,
        editor_id: editorId,
      })
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
