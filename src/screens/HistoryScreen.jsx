import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getWorkouts, getExercises, saveWorkout, createExercise, deleteWorkout as repoDelete } from '../db/repo.js'
import { syncNow } from '../db/sync.js'
import ExercisePicker from '../components/ExercisePicker.jsx'

function fmtDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

// локальный документ тренировки → редактируемая форма [{ exercise, sets:[{weight,reps}] }]
function toEntries(workout) {
  return (workout.entries ?? []).map((e) => ({
    exercise: e.exercise ?? { id: e.exercise_id, name: '—' },
    sets: (e.sets ?? []).map((s) => ({ weight: s.weight, reps: s.reps })),
  }))
}

export default function HistoryScreen({ user }) {
  // История и справочник — из локальной базы (офлайн-доступны). Любая правка
  // пишется в Dexie и эти списки обновляются мгновенно (useLiveQuery), а
  // отправку на сервер берёт на себя очередь синхронизации.
  const workouts = useLiveQuery(() => getWorkouts(user.id), [user.id])
  const exercises = useLiveQuery(() => getExercises(), [], [])
  const loading = workouts === undefined
  const list = workouts ?? []

  const [editId, setEditId] = useState(null)     // id редактируемой тренировки
  const [draft, setDraft] = useState([])          // entries в режиме правки
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)         // сохранение/удаление
  const [message, setMessage] = useState(null)

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

  // Сохранение правок: переписываем состав тренировки в локальной базе,
  // изменения встают в очередь и уходят на сервер при наличии сети.
  async function saveEdit() {
    const cleaned = draft.filter((e) => e.sets.length > 0)
    if (cleaned.length === 0) {
      setMessage({ type: 'error', text: 'В тренировке нет подходов. Удали её или добавь упражнение.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await saveWorkout({ id: editId, user_id: user.id, entries: cleaned })
      cancelEdit()
      setMessage({
        type: 'ok',
        text: navigator.onLine ? 'Изменения сохранены' : 'Сохранено офлайн — отправлю при сети 📥',
      })
      if (navigator.onLine) syncNow(user.id)
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
      await repoDelete(id)
      if (editId === id) cancelEdit()
      setMessage({
        type: 'ok',
        text: navigator.onLine ? 'Тренировка удалена' : 'Удалено офлайн — синхронизирую при сети 📥',
      })
      if (navigator.onLine) syncNow(user.id)
    } catch (err) {
      setMessage({ type: 'error', text: 'Не удалилось: ' + (err.message ?? err) })
    } finally {
      setBusy(false)
    }
  }

  // --- summary для свёрнутой карточки ---
  function summarize(w) {
    const entries = w.entries ?? []
    const exCount = entries.length
    const setCount = entries.reduce((n, e) => n + (e.sets?.length ?? 0), 0)
    return { exCount, setCount }
  }

  return (
    <div className="screen">
      <h2 className="screen-title">История</h2>

      {message && (
        <div className={message.type === 'error' ? 'banner error' : 'banner ok'}>{message.text}</div>
      )}

      {loading && <p className="muted">Загрузка…</p>}

      {!loading && list.length === 0 && (
        <p className="muted empty">Пока нет записанных тренировок.</p>
      )}

      {list.map((w) => {
        const editing = editId === w.id
        const { exCount, setCount } = summarize(w)
        const unsynced = Boolean(w._dirty)
        return (
          <div key={w.id} className="card history-card">
            <div className="history-head">
              <div>
                <div className="history-date">
                  {fmtDate(w.performed_at)}
                  {unsynced && <span className="dot-unsynced" title="Ждёт синхронизации">●</span>}
                </div>
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
                {(w.entries ?? []).map((e, i) => (
                  <li key={i} className="history-ex">
                    <span className="history-ex-name">{e.exercise?.name ?? '—'}</span>
                    <span className="history-ex-sets">
                      {(e.sets ?? []).map((s) => `${s.weight}×${s.reps}`).join(', ') || '—'}
                    </span>
                  </li>
                ))}
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
          onCreate={createExercise}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
