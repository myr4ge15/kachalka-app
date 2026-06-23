import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../db/supabase.js'
import { withTimeout } from '../lib/withTimeout.js'
import { getCache, setCache } from '../lib/cache.js'
import ExercisePicker from '../components/ExercisePicker.jsx'

function fmtDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

// workout из БД → редактируемая форма [{ exercise, sets:[{weight,reps}] }]
function toEntries(workout) {
  return [...(workout.workout_exercises ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((we) => ({
      exercise: we.exercise ?? { id: we.exercise_id, name: '—' },
      sets: [...(we.sets ?? [])]
        .sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
        .map((s) => ({ weight: s.weight, reps: s.reps })),
    }))
}

export default function HistoryScreen({ user }) {
  const wKey = 'history:' + user.id
  const [workouts, setWorkouts] = useState(() => getCache(wKey) ?? [])
  const [exercises, setExercises] = useState(() => getCache('exercises') ?? [])
  // Если данные уже в кэше — не показываем «Загрузка…», обновляем в фоне
  const [loading, setLoading] = useState(() => getCache(wKey) === undefined)
  const [error, setError] = useState('')

  const [editId, setEditId] = useState(null)     // id редактируемой тренировки
  const [draft, setDraft] = useState([])          // entries в режиме правки
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)         // сохранение/удаление
  const [message, setMessage] = useState(null)

  const load = useCallback(async () => {
    // Спиннер только если показывать пока нечего; иначе тихо обновляем из кэша
    if (getCache(wKey) === undefined) setLoading(true)
    setError('')
    try {
      const { data, error: e } = await withTimeout(
        supabase
          .from('workouts')
          .select(
            'id, performed_at, workout_exercises(id, position, exercise_id, exercise:exercises(id, name, muscle_group), sets(id, set_number, weight, reps))'
          )
          .eq('user_id', user.id)
          .order('performed_at', { ascending: false })
      )
      if (e) throw e
      const rows = data ?? []
      setWorkouts(rows)
      setCache(wKey, rows)
    } catch (err) {
      setError('Не удалось загрузить историю: ' + (err.message ?? err))
    } finally {
      setLoading(false)
    }
  }, [user.id, wKey])

  useEffect(() => { load() }, [load])

  // справочник нужен для добавления упражнения в режиме правки
  useEffect(() => {
    supabase
      .from('exercises')
      .select('id, name, muscle_group, is_bench_lift')
      .order('muscle_group')
      .order('name')
      .then(({ data }) => {
        if (data) { setExercises(data); setCache('exercises', data) }
      })
  }, [])

  function startEdit(w) {
    setMessage(null)
    setEditId(w.id)
    setDraft(toEntries(w))
  }

  function cancelEdit() {
    setEditId(null)
    setDraft([])
    setPickerOpen(false)
  }

  // --- правка черновика ---
  function updateSet(ei, si, field, value) {
    setDraft((d) =>
      d.map((e, i) =>
        i !== ei ? e : { ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, [field]: value } : s)) }
      )
    )
  }
  function step(ei, si, field, delta) {
    const cur = Number(draft[ei].sets[si][field])
    const min = field === 'reps' ? 1 : 0
    updateSet(ei, si, field, Math.max(min, Math.round((cur + delta) * 100) / 100))
  }
  function addSet(ei) {
    setDraft((d) =>
      d.map((e, i) => {
        if (i !== ei) return e
        const last = e.sets[e.sets.length - 1] ?? { weight: 20, reps: 10 }
        return { ...e, sets: [...e.sets, { ...last }] }
      })
    )
  }
  function removeSet(ei, si) {
    setDraft((d) => d.map((e, i) => (i === ei ? { ...e, sets: e.sets.filter((_, j) => j !== si) } : e)))
  }
  function removeExercise(ei) {
    setDraft((d) => d.filter((_, i) => i !== ei))
  }
  function addExercise(ex) {
    setPickerOpen(false)
    setDraft((d) => (d.some((e) => e.exercise.id === ex.id) ? d : [...d, { exercise: ex, sets: [{ weight: 20, reps: 10 }] }]))
  }

  // Сохранение правок: переписываем состав тренировки.
  // workout_exercises удаляются с каскадом на sets, затем вставляем заново.
  async function saveEdit() {
    const cleaned = draft.filter((e) => e.sets.length > 0)
    if (cleaned.length === 0) {
      setMessage({ type: 'error', text: 'В тренировке нет подходов. Удали её или добавь упражнение.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      // Переписываем состав одним атомарным запросом (RPC replace_workout):
      // delete + insert идут в одной транзакции на сервере, без сирот.
      const payload = cleaned.map((e) => ({
        exercise_id: e.exercise.id,
        sets: e.sets.map((s) => ({
          weight: Number(s.weight),
          reps: Number(s.reps),
        })),
      }))

      const { error } = await withTimeout(
        supabase.rpc('replace_workout', { p_workout_id: editId, p_entries: payload })
      )
      if (error) throw error

      // Обновляем тренировку локально, без повторной загрузки всей истории.
      // Реальные id подтянутся при следующей фоновой загрузке.
      const newWEs = cleaned.map((e, i) => ({
        id: `local-${i}`,
        position: i,
        exercise_id: e.exercise.id,
        exercise: {
          id: e.exercise.id,
          name: e.exercise.name,
          muscle_group: e.exercise.muscle_group,
        },
        sets: e.sets.map((s, j) => ({
          id: `local-${i}-${j}`,
          set_number: j + 1,
          weight: Number(s.weight),
          reps: Number(s.reps),
        })),
      }))
      const savedId = editId
      cancelEdit()
      setWorkouts((ws) => {
        const next = ws.map((w) =>
          w.id === savedId ? { ...w, workout_exercises: newWEs } : w
        )
        setCache(wKey, next)
        return next
      })
      setMessage({ type: 'ok', text: 'Изменения сохранены' })
    } catch (err) {
      setMessage({ type: 'error', text: 'Не сохранилось: ' + (err.message ?? err) })
    } finally {
      setBusy(false)
    }
  }

  async function deleteWorkout(id) {
    if (!window.confirm('Удалить эту тренировку? Действие необратимо.')) return
    setBusy(true)
    setMessage(null)
    try {
      const { error: e } = await withTimeout(supabase.from('workouts').delete().eq('id', id))
      if (e) throw e
      if (editId === id) cancelEdit()
      // Убираем локально, без повторной загрузки всей истории
      setWorkouts((ws) => {
        const next = ws.filter((w) => w.id !== id)
        setCache(wKey, next)
        return next
      })
      setMessage({ type: 'ok', text: 'Тренировка удалена' })
    } catch (err) {
      setMessage({ type: 'error', text: 'Не удалилось: ' + (err.message ?? err) })
    } finally {
      setBusy(false)
    }
  }

  // --- summary для свёрнутой карточки ---
  function summarize(w) {
    const wes = w.workout_exercises ?? []
    const exCount = wes.length
    const setCount = wes.reduce((n, we) => n + (we.sets?.length ?? 0), 0)
    return { exCount, setCount }
  }

  return (
    <div className="screen">
      <h2 className="screen-title">История</h2>

      {message && (
        <div className={message.type === 'error' ? 'banner error' : 'banner ok'}>{message.text}</div>
      )}

      {loading && <p className="muted">Загрузка…</p>}
      {error && <div className="banner error">{error}</div>}

      {!loading && !error && workouts.length === 0 && (
        <p className="muted empty">Пока нет записанных тренировок.</p>
      )}

      {workouts.map((w) => {
        const editing = editId === w.id
        const { exCount, setCount } = summarize(w)
        return (
          <div key={w.id} className="card history-card">
            <div className="history-head">
              <div>
                <div className="history-date">{fmtDate(w.performed_at)}</div>
                {!editing && (
                  <div className="muted history-sub">
                    {exCount} упр · {setCount} подх.
                  </div>
                )}
              </div>
              {!editing ? (
                <div className="history-actions">
                  <button className="link-btn" onClick={() => startEdit(w)}>править</button>
                  <button className="link-btn danger" disabled={busy} onClick={() => deleteWorkout(w.id)}>
                    удалить
                  </button>
                </div>
              ) : (
                <button className="link-btn" onClick={cancelEdit}>отмена</button>
              )}
            </div>

            {!editing && (
              <ul className="history-list">
                {[...(w.workout_exercises ?? [])]
                  .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                  .map((we) => {
                    const sets = [...(we.sets ?? [])].sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
                    return (
                      <li key={we.id} className="history-ex">
                        <span className="history-ex-name">{we.exercise?.name ?? '—'}</span>
                        <span className="history-ex-sets">
                          {sets.map((s) => `${s.weight}×${s.reps}`).join(', ') || '—'}
                        </span>
                      </li>
                    )
                  })}
              </ul>
            )}

            {editing && (
              <div className="history-edit">
                {draft.map((entry, ei) => (
                  <div key={entry.exercise.id} className="edit-ex">
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
                    <button className="btn ghost full" onClick={() => addSet(ei)}>+ подход</button>
                  </div>
                ))}

                <button className="btn outline full" onClick={() => setPickerOpen(true)}>
                  + Добавить упражнение
                </button>
                <button className="btn primary full save-btn" disabled={busy} onClick={saveEdit}>
                  {busy ? 'Сохранение…' : 'Сохранить изменения'}
                </button>
                <button
                  className="link-btn danger full-link"
                  disabled={busy}
                  onClick={() => deleteWorkout(w.id)}
                >
                  Удалить тренировку
                </button>
              </div>
            )}
          </div>
        )
      })}

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
