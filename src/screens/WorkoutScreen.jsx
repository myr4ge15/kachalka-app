import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getExercises, saveWorkout, createExercise } from '../db/repo.js'
import { syncNow } from '../db/sync.js'
import { getCache, setCache, clearCache } from '../lib/cache.js'
import ExercisePicker from '../components/ExercisePicker.jsx'

export default function WorkoutScreen({ user }) {
  // Справочник — из локальной базы (офлайн-доступен). Обновляется автоматически,
  // когда фоновый синк подтянет свежий справочник с сервера.
  const exercises = useLiveQuery(() => getExercises(), [], [])
  // Черновик переживает переключение вкладок (экран монтируется заново при
  // условном рендере App). Храним его в in-memory кэше по пользователю.
  const DRAFT_KEY = `workout_draft_${user.id}`
  const [entries, setEntries] = useState(() => getCache(DRAFT_KEY) ?? []) // [{ exercise, sets: [{weight, reps}] }]
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null) // {type, text}

  // Сохраняем черновик при каждом изменении состава.
  useEffect(() => { setCache(DRAFT_KEY, entries) }, [DRAFT_KEY, entries])

  function addExercise(ex) {
    setPickerOpen(false)
    if (entries.some((e) => e.exercise.id === ex.id)) {
      setMessage({ type: 'error', text: 'Это упражнение уже добавлено.' })
      return
    }
    setEntries([...entries, { exercise: ex, sets: [{ weight: 20, reps: 10 }] }])
  }

  function removeExercise(idx) {
    setEntries(entries.filter((_, i) => i !== idx))
  }

  function updateSet(ei, si, field, value) {
    const next = entries.map((e, i) => {
      if (i !== ei) return e
      const sets = e.sets.map((s, j) => (j === si ? { ...s, [field]: value } : s))
      return { ...e, sets }
    })
    setEntries(next)
  }

  function step(ei, si, field, delta) {
    const cur = entries[ei].sets[si][field]
    const min = field === 'reps' ? 1 : 0
    const next = Math.max(min, Math.round((Number(cur) + delta) * 100) / 100)
    updateSet(ei, si, field, next)
  }

  function addSet(ei) {
    // повтор предыдущего подхода в один тап
    const last = entries[ei].sets[entries[ei].sets.length - 1] ?? { weight: 20, reps: 10 }
    const next = entries.map((e, i) =>
      i === ei ? { ...e, sets: [...e.sets, { ...last }] } : e
    )
    setEntries(next)
  }

  function removeSet(ei, si) {
    const next = entries.map((e, i) =>
      i === ei ? { ...e, sets: e.sets.filter((_, j) => j !== si) } : e
    )
    setEntries(next)
  }

  const totalSets = entries.reduce((n, e) => n + e.sets.length, 0)
  const canSave = entries.length > 0 && totalSets > 0 && !saving

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      // Пишем в локальную базу — мгновенно и без сети. Отправку на сервер
      // берёт на себя очередь синхронизации (toolbar покажет статус).
      await saveWorkout({ user_id: user.id, entries })
      setEntries([])
      clearCache(DRAFT_KEY)
      if (navigator.onLine) {
        setMessage({ type: 'ok', text: 'Тренировка сохранена 💪' })
        syncNow(user.id) // отправим прямо сейчас, не дожидаясь таймера
      } else {
        setMessage({ type: 'ok', text: 'Сохранено офлайн — отправлю, когда появится сеть 📥' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Не сохранилось: ' + (err.message ?? err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screen">
      <h2 className="screen-title">Новая тренировка</h2>

      {message && (
        <div className={message.type === 'error' ? 'banner error' : 'banner ok'}>
          {message.text}
        </div>
      )}

      {entries.length === 0 && (
        <p className="muted empty">Добавь упражнение, чтобы начать.</p>
      )}

      {entries.map((entry, ei) => (
        <div key={entry.exercise.id} className="card exercise-card">
          <div className="exercise-head">
            <span className="exercise-name">{entry.exercise.name}</span>
            <button className="link-btn danger" onClick={() => removeExercise(ei)}>убрать</button>
          </div>

          <div className="sets-head">
            <span>#</span><span>кг</span><span>повт.</span><span></span>
          </div>

          {entry.sets.map((s, si) => (
            <div key={si} className="set-row">
              <span className="set-num">{si + 1}</span>

              <div className="stepper">
                <button onClick={() => step(ei, si, 'weight', -2.5)}>−</button>
                <input
                  type="text" inputMode="decimal" value={s.weight}
                  onChange={(e) => updateSet(ei, si, 'weight', e.target.value.replace(',', '.'))}
                />
                <button onClick={() => step(ei, si, 'weight', 2.5)}>+</button>
              </div>

              <div className="stepper">
                <button onClick={() => step(ei, si, 'reps', -1)}>−</button>
                <input
                  type="number" inputMode="numeric" value={s.reps}
                  onChange={(e) => updateSet(ei, si, 'reps', e.target.value)}
                />
                <button onClick={() => step(ei, si, 'reps', 1)}>+</button>
              </div>

              <button className="link-btn danger small" onClick={() => removeSet(ei, si)}>✕</button>
            </div>
          ))}

          <button className="btn ghost full" onClick={() => addSet(ei)}>
            + подход (повтор предыдущего)
          </button>
        </div>
      ))}

      <button className="btn outline full" onClick={() => setPickerOpen(true)}>
        + Добавить упражнение
      </button>

      <button className="btn primary full save-btn" disabled={!canSave} onClick={save}>
        {saving ? 'Сохранение…' : `Сохранить${totalSets ? ` (${totalSets})` : ''}`}
      </button>

      {pickerOpen && (
        <ExercisePicker
          exercises={exercises}
          onPick={addExercise}
          onCreate={createExercise}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
