import { useState, useEffect } from 'react'
import { supabase } from '../db/supabase.js'
import ExercisePicker from '../components/ExercisePicker.jsx'

export default function WorkoutScreen({ user }) {
  const [exercises, setExercises] = useState([])
  const [entries, setEntries] = useState([]) // [{ exercise, sets: [{weight, reps}] }]
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null) // {type, text}

  useEffect(() => {
    supabase
      .from('exercises')
      .select('id, name, muscle_group, is_bench_lift')
      .order('muscle_group')
      .order('name')
      .then(({ data, error }) => {
        if (error) setMessage({ type: 'error', text: 'Справочник не загрузился: ' + error.message })
        else setExercises(data ?? [])
      })
  }, [])

  function addExercise(ex) {
    setPickerOpen(false)
    if (entries.some((e) => e.exercise.id === ex.id)) return
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
      // 1) тренировка
      const { data: w, error: we } = await supabase
        .from('workouts')
        .insert({ user_id: user.id })
        .select('id')
        .single()
      if (we) throw we

      // 2) упражнения + подходы
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        const { data: wex, error: wexErr } = await supabase
          .from('workout_exercises')
          .insert({ workout_id: w.id, exercise_id: entry.exercise.id, position: i })
          .select('id')
          .single()
        if (wexErr) throw wexErr

        const rows = entry.sets.map((s, j) => ({
          workout_exercise_id: wex.id,
          set_number: j + 1,
          weight: Number(s.weight),
          reps: Number(s.reps),
        }))
        const { error: setsErr } = await supabase.from('sets').insert(rows)
        if (setsErr) throw setsErr
      }

      setEntries([])
      setMessage({ type: 'ok', text: 'Тренировка сохранена 💪' })
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
                  type="number" inputMode="decimal" value={s.weight}
                  onChange={(e) => updateSet(ei, si, 'weight', e.target.value)}
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
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
