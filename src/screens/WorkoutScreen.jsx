import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getExercises, getWorkout, saveWorkout, createExercise, deleteWorkout as repoDelete } from '../db/repo.js'
import { detectNewPrsOnSave, detectGoalReachedOnSave } from '../db/notifications.js'
import { syncNow } from '../db/sync.js'
import { getCache, setCache, clearCache } from '../lib/cache.js'
import { showToast } from '../components/Toast.jsx'
import ExercisePicker from '../components/ExercisePicker.jsx'
import TemplatePicker from '../components/TemplatePicker.jsx'

// локальный документ → редактируемая форма [{ exercise, sets:[{weight,reps}] }]
function toEntries(workout) {
  return (workout?.entries ?? []).map((e) => ({
    exercise: e.exercise ?? { id: e.exercise_id, name: '—' },
    sets: (e.sets ?? []).map((s) => ({ weight: s.weight, reps: s.reps })),
  }))
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

// ISO-дату (performed_at) → YYYY-MM-DD для <input type=date> и обратно.
function toDateInput(iso) {
  const d = iso ? new Date(iso) : new Date()
  const off = d.getTimezoneOffset() * 60000
  return new Date(d - off).toISOString().slice(0, 10)
}
function fromDateInput(value, prevIso) {
  // сохраняем время суток из исходной даты (или текущее), меняем только день
  const base = prevIso ? new Date(prevIso) : new Date()
  const [y, m, d] = value.split('-').map(Number)
  base.setFullYear(y, m - 1, d)
  return base.toISOString()
}

// Экран-композер (новая тренировка) и экран-деталь (правка существующей).
//   workoutId == null → новая (черновик в кэше переживает уход с экрана)
//   workoutId != null → существующая (читаем из документа, кэш не трогаем)
export default function WorkoutScreen({ user, workoutId = null, onBack }) {
  const isNew = workoutId == null
  // Справочник — из локальной базы (офлайн-доступен).
  const exercises = useLiveQuery(() => getExercises(), [], [])

  // Черновик в памяти — только для новой тренировки (ключ привязан к пользователю).
  const DRAFT_KEY = `workout_draft_new_${user.id}`

  const [entries, setEntries] = useState(() => (isNew ? getCache(DRAFT_KEY) ?? [] : []))
  const [performedAt, setPerformedAt] = useState(() => new Date().toISOString())
  const [loading, setLoading] = useState(!isNew)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [tplPickerOpen, setTplPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null) // {type, text}

  // Сохраняем черновик новой тренировки при каждом изменении состава.
  useEffect(() => {
    if (isNew) setCache(DRAFT_KEY, entries)
  }, [isNew, DRAFT_KEY, entries])

  // Загрузка существующей тренировки на маунте (документ — источник правды).
  useEffect(() => {
    if (isNew) return
    let alive = true
    setLoading(true)
    getWorkout(workoutId).then((w) => {
      if (!alive) return
      if (w) {
        setEntries(toEntries(w))
        setPerformedAt(w.performed_at ?? new Date().toISOString())
      } else {
        setMessage({ type: 'error', text: 'Тренировка не найдена.' })
      }
      setLoading(false)
    })
    return () => { alive = false }
  }, [isNew, workoutId])

  function addExercise(ex) {
    setPickerOpen(false)
    if (entries.some((e) => e.exercise.id === ex.id)) {
      setMessage({ type: 'error', text: 'Это упражнение уже добавлено.' })
      return
    }
    setEntries([...entries, { exercise: ex, sets: [{ weight: 20, reps: 10 }] }])
  }

  function removeExercise(idx) {
    const removed = entries[idx]
    setEntries(entries.filter((_, i) => i !== idx))
    if (!removed) return
    // Удаление срабатывает сразу, но даём окно отмены — кнопка удаления
    // соседствует с зоной сохранения/добавления, легко нажать случайно.
    showToast({
      emoji: '🗑',
      title: 'Упражнение убрано',
      sub: removed.exercise?.name,
      actionLabel: 'Отменить',
      duration: 6000,
      onAction: () => setEntries((prev) => {
        // Анти-дубль: если упражнение успели вернуть/добавить — не плодим копию.
        if (prev.some((e) => e.exercise.id === removed.exercise.id)) return prev
        const next = prev.slice()
        next.splice(Math.min(idx, next.length), 0, removed)
        return next
      }),
    })
  }

  // Применение шаблона (только новая тренировка): добавляем упражнения шаблона,
  // которых ещё нет (анти-дубль по exercise.id), каждому — дефолтный подход 20×10.
  function applyTemplate(tpl) {
    setTplPickerOpen(false)
    const have = new Set(entries.map((e) => e.exercise.id))
    const toAdd = (tpl.exercises ?? [])
      .map((e) => e.exercise ?? { id: e.exercise_id, name: '—' })
      .filter((ex) => ex.id && !have.has(ex.id))
      .map((ex) => ({ exercise: ex, sets: [{ weight: 20, reps: 10 }] }))
    if (toAdd.length === 0) {
      setMessage({ type: 'error', text: 'Все упражнения шаблона уже добавлены.' })
      return
    }
    setEntries([...entries, ...toAdd])
  }

  function updateSet(ei, si, field, value) {
    setEntries(entries.map((e, i) => {
      if (i !== ei) return e
      const sets = e.sets.map((s, j) => (j === si ? { ...s, [field]: value } : s))
      return { ...e, sets }
    }))
  }

  function step(ei, si, field, delta) {
    const min = field === 'reps' ? 1 : 0
    // Значение в state — строка из инпута: '', '.', '1.2.3' дают NaN. В этом
    // случае стартуем степпер от минимума, иначе в поле попадал бы «NaN».
    const base = Number(entries[ei].sets[si][field])
    const cur = Number.isFinite(base) ? base : min
    const next = Math.max(min, Math.round((cur + delta) * 100) / 100)
    updateSet(ei, si, field, next)
  }

  function addSet(ei) {
    const last = entries[ei].sets[entries[ei].sets.length - 1] ?? { weight: 20, reps: 10 }
    setEntries(entries.map((e, i) => (i === ei ? { ...e, sets: [...e.sets, { ...last }] } : e)))
  }

  function removeSet(ei, si) {
    const entry = entries[ei]
    const removed = entry?.sets[si]
    setEntries(entries.map((e, i) =>
      i === ei ? { ...e, sets: e.sets.filter((_, j) => j !== si) } : e
    ))
    if (!removed) return
    const exId = entry.exercise.id
    // Точечная отмена: ищем упражнение по id (индекс мог сдвинуться) и
    // возвращаем подход на прежнее место.
    showToast({
      emoji: '🗑',
      title: 'Подход удалён',
      sub: entry.exercise?.name,
      actionLabel: 'Отменить',
      duration: 6000,
      onAction: () => setEntries((prev) => prev.map((e) => {
        if (e.exercise.id !== exId) return e
        const sets = e.sets.slice()
        sets.splice(Math.min(si, sets.length), 0, removed)
        return { ...e, sets }
      })),
    })
  }

  const totalSets = entries.reduce((n, e) => n + e.sets.length, 0)
  const canSave = entries.length > 0 && totalSets > 0 && !saving

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const wId = await saveWorkout({
        id: isNew ? undefined : workoutId,
        user_id: user.id,
        performed_at: performedAt,
        entries,
      })
      if (isNew) clearCache(DRAFT_KEY)
      // Поздравление с новым личным рекордом (ТЗ §4.5). Только для новой
      // тренировки — чтобы повторная правка старой записи не поднимала ложный
      // рекорд. Рекорды считаются из локальных данных, сеть не нужна.
      if (isNew) {
        try {
          const prs = await detectNewPrsOnSave(user.id, wId)
          if (prs.length) {
            const top = prs.reduce((a, b) => (b.weight > a.weight ? b : a), prs[0])
            const extra = prs.length > 1 ? ` +${prs.length - 1}` : ''
            showToast({
              title: 'Новый рекорд!',
              sub: `${top.name} — ${top.weight} кг (было ${top.prev} кг)${extra}`,
            })
          }
          // Достижение личной цели (ЛК). Поздравляем один раз; если совпало с
          // рекордом — поздравление о цели перекрывает тост рекорда (важнее).
          const reached = await detectGoalReachedOnSave(user.id, wId)
          if (reached) {
            showToast({
              emoji: '🎯',
              title: 'Цель достигнута!',
              sub: `${reached.name} — ${reached.weight} кг`,
            })
          }
        } catch { /* тост необязателен */ }
      }
      if (navigator.onLine) syncNow(user.id)
      onBack?.()
    } catch (err) {
      setMessage({ type: 'error', text: 'Не сохранилось: ' + (err.message ?? err) })
      setSaving(false)
    }
  }

  async function remove() {
    if (!window.confirm('Удалить эту тренировку? Действие необратимо.')) return
    setSaving(true)
    setMessage(null)
    try {
      await repoDelete(workoutId)
      if (navigator.onLine) syncNow(user.id)
      onBack?.()
    } catch (err) {
      setMessage({ type: 'error', text: 'Не удалилось: ' + (err.message ?? err) })
      setSaving(false)
    }
  }

  return (
    <div className="screen">
      <div className="detail-head">
        <button className="link-btn back-link" onClick={() => onBack?.()}>← Назад</button>
        <h2 className="screen-title detail-title">
          {isNew ? 'Новая тренировка' : fmtDate(performedAt)}
        </h2>
      </div>

      {message && (
        <div className={message.type === 'error' ? 'banner error' : 'banner ok'}>
          {message.text}
        </div>
      )}

      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : (
        <>
          <label className="date-field">
            <span className="muted">Дата</span>
            <span className="date-picker">
              <span className="date-picker__icon" aria-hidden="true">📅</span>
              <span className="date-picker__value">{fmtDate(performedAt)}</span>
              <span className="date-picker__chevron" aria-hidden="true">▾</span>
              <input
                type="date"
                value={toDateInput(performedAt)}
                onChange={(e) => setPerformedAt(fromDateInput(e.target.value, performedAt))}
              />
            </span>
          </label>

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

          {isNew && (
            <button className="btn outline full" onClick={() => setTplPickerOpen(true)}>
              📋 Выбрать шаблон
            </button>
          )}

          <button className="btn outline full" onClick={() => setPickerOpen(true)}>
            + Добавить упражнение
          </button>

          <button className="btn primary full save-btn" disabled={!canSave} onClick={save}>
            {saving ? 'Сохранение…' : `Сохранить${totalSets ? ` (${totalSets})` : ''}`}
          </button>

          {!isNew && (
            <button className="link-btn danger full-link" disabled={saving} onClick={remove}>
              Удалить тренировку
            </button>
          )}
        </>
      )}

      {pickerOpen && (
        <ExercisePicker
          exercises={exercises}
          onPick={addExercise}
          onCreate={createExercise}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {tplPickerOpen && (
        <TemplatePicker
          user={user}
          onPick={applyTemplate}
          onClose={() => setTplPickerOpen(false)}
        />
      )}
    </div>
  )
}
