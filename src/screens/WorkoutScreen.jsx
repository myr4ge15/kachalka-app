import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getExercises, getWorkout, saveWorkout, createExercise, deleteWorkout as repoDelete } from '../db/repo.js'
import { detectNewPrsOnSave, detectGoalReachedOnSave } from '../db/notifications.js'
import { syncNow } from '../db/sync.js'
import { getCache, setCache, clearCache } from '../lib/cache.js'
import { showToast } from '../components/Toast.jsx'
import { exerciseMetric, isCountMetric, fmtMetricValue, fmtTime, parseTime } from '../lib/metric.js'
import { exportWorkouts } from '../lib/exportWorkout.js'
import HoldButton from '../components/HoldButton.jsx'
import ExercisePicker from '../components/ExercisePicker.jsx'
import TemplatePicker from '../components/TemplatePicker.jsx'

// локальный документ → редактируемая форма [{ exercise, sets:[{weight,reps}] }]
function toEntries(workout) {
  return (workout?.entries ?? []).map((e) => ({
    exercise: e.exercise ?? { id: e.exercise_id, name: '—' },
    sets: (e.sets ?? []).map((s) => ({ weight: s.weight, reps: s.reps })),
  }))
}

// Дефолтный подход по типу упражнения (weight=0 у не-весовых, чтобы тоннаж/
// лидерборд не засорять): весовое — 20×10; reps — 10 повторов; time — 60 с (1:00,
// время хранится секундами в reps).
function defaultSet(ex) {
  const m = exerciseMetric(ex)
  if (m === 'time') return { weight: 0, reps: 60 }
  if (m === 'reps') return { weight: 0, reps: 10 }
  return { weight: 20, reps: 10 }
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
  // null → пикер в режиме «добавить»; число → индекс entry, который заменяем.
  const [replaceIdx, setReplaceIdx] = useState(null)
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

  function openAddPicker() {
    setReplaceIdx(null)
    setPickerOpen(true)
  }

  function openReplacePicker(idx) {
    setReplaceIdx(idx)
    setPickerOpen(true)
  }

  function closePicker() {
    setPickerOpen(false)
    setReplaceIdx(null)
  }

  // Роутер выбора из пикера: добавить новое упражнение или заменить существующее.
  function handlePick(ex) {
    if (replaceIdx != null) replaceExercise(replaceIdx, ex)
    else addExercise(ex)
  }

  function addExercise(ex) {
    setPickerOpen(false)
    if (entries.some((e) => e.exercise.id === ex.id)) {
      setMessage({ type: 'error', text: 'Это упражнение уже добавлено.' })
      return
    }
    setEntries([...entries, { exercise: ex, sets: [defaultSet(ex)] }])
  }

  // Замена упражнения в записи: подходы сохраняем (не вводить заново). Для
  // не-весового нового упражнения обнуляем weight — инвариант «вес=0 у не-весовых».
  function replaceExercise(idx, ex) {
    setPickerOpen(false)
    setReplaceIdx(null)
    const cur = entries[idx]
    if (!cur || cur.exercise.id === ex.id) return
    if (entries.some((e, i) => i !== idx && e.exercise.id === ex.id)) {
      setMessage({ type: 'error', text: 'Это упражнение уже добавлено.' })
      return
    }
    const count = isCountMetric(exerciseMetric(ex))
    const sets = count ? cur.sets.map((s) => ({ ...s, weight: 0 })) : cur.sets
    setEntries(entries.map((e, i) => (i === idx ? { exercise: ex, sets } : e)))
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

  // Подходы из целевого плана упражнения шаблона: sets подходов по reps повторов
  // (× weight у весовых). Нет плана (легаси-шаблон) → один дефолтный подход.
  function setsFromTemplate(ex, item) {
    const n = Math.max(1, Math.round(Number(item?.sets)) || 0)
    if (!item?.sets) return [defaultSet(ex)]
    const count = isCountMetric(exerciseMetric(ex))
    const reps = Math.max(1, Math.round(Number(item.reps)) || defaultSet(ex).reps)
    const weight = count ? 0 : (Number(item.weight) || 0)
    return Array.from({ length: n }, () => ({ weight, reps }))
  }

  // Применение шаблона (только новая тренировка): добавляем упражнения шаблона,
  // которых ещё нет (анти-дубль по exercise.id), каждому — подходы по целевому
  // плану шаблона (подходы × повторы × вес), либо один дефолтный, если плана нет.
  function applyTemplate(tpl) {
    setTplPickerOpen(false)
    const have = new Set(entries.map((e) => e.exercise.id))
    const toAdd = (tpl.exercises ?? [])
      .filter((item) => (item.exercise?.id ?? item.exercise_id) && !have.has(item.exercise?.id ?? item.exercise_id))
      .map((item) => {
        const ex = item.exercise ?? { id: item.exercise_id, name: '—' }
        return { exercise: ex, sets: setsFromTemplate(ex, item) }
      })
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
    const entry = entries[ei]
    const last = entry.sets[entry.sets.length - 1] ?? defaultSet(entry.exercise)
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
            const top = prs.reduce((a, b) => (b.value > a.value ? b : a), prs[0])
            const extra = prs.length > 1 ? ` +${prs.length - 1}` : ''
            showToast({
              title: 'Новый рекорд!',
              sub: `${top.name} — ${fmtMetricValue(top.metric, top.value)} (было ${fmtMetricValue(top.metric, top.prev)})${extra}`,
            })
          }
          // Достижение личной цели (ЛК). Поздравляем один раз; если совпало с
          // рекордом — поздравление о цели перекрывает тост рекорда (важнее).
          const reached = await detectGoalReachedOnSave(user.id, wId)
          if (reached.length) {
            const top = reached.reduce((a, b) => (Number(b.value) > Number(a.value) ? b : a), reached[0])
            const extra = reached.length > 1 ? ` +${reached.length - 1}` : ''
            showToast({
              emoji: '🎯',
              title: reached.length > 1 ? 'Цели достигнуты!' : 'Цель достигнута!',
              sub: `${top.name} — ${fmtMetricValue(top.metric, top.value)}${extra}`,
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

  // Экспорт этой тренировки в JSON-файл (из текущего состава формы).
  function exportOne() {
    const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
    exportWorkouts(
      { id: workoutId, performed_at: performedAt, created_at: null, entries },
      appVersion
    )
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

          {entries.map((entry, ei) => {
            const metric = exerciseMetric(entry.exercise)
            const count = isCountMetric(metric) // своего веса / на время — без столбца «кг»
            const isTime = metric === 'time'
            const valLabel = isTime ? 'мин:сек' : 'повт.'
            return (
            <div key={entry.exercise.id} className={`card exercise-card${count ? ' count' : ''}`}>
              <div className="exercise-head">
                <span className="exercise-name">{entry.exercise.name}</span>
                <span className="exercise-actions">
                  <button className="link-btn" onClick={() => openReplacePicker(ei)}>заменить</button>
                  <button className="link-btn danger" onClick={() => removeExercise(ei)}>убрать</button>
                </span>
              </div>

              <div className="sets-head">
                {count
                  ? <><span>#</span><span>{valLabel}</span><span></span></>
                  : <><span>#</span><span>кг</span><span>повт.</span><span></span></>}
              </div>

              {entry.sets.map((s, si) => (
                <div key={si} className="set-row">
                  <span className="set-num">{si + 1}</span>

                  {!count && (
                    <div className="stepper">
                      <HoldButton onTrigger={() => step(ei, si, 'weight', -1.25)}>−</HoldButton>
                      <input
                        type="text" inputMode="decimal" value={s.weight}
                        onChange={(e) => updateSet(ei, si, 'weight', e.target.value.replace(',', '.'))}
                      />
                      <HoldButton onTrigger={() => step(ei, si, 'weight', 1.25)}>+</HoldButton>
                    </div>
                  )}

                  {isTime ? (
                    <div className="stepper">
                      <HoldButton onTrigger={() => step(ei, si, 'reps', -15)}>−</HoldButton>
                      <input
                        type="text" inputMode="numeric" value={fmtTime(s.reps)}
                        onChange={(e) => updateSet(ei, si, 'reps', parseTime(e.target.value))}
                      />
                      <HoldButton onTrigger={() => step(ei, si, 'reps', 15)}>+</HoldButton>
                    </div>
                  ) : (
                    <div className="stepper">
                      <HoldButton onTrigger={() => step(ei, si, 'reps', -1)}>−</HoldButton>
                      <input
                        type="number" inputMode="numeric" value={s.reps}
                        onChange={(e) => updateSet(ei, si, 'reps', e.target.value)}
                      />
                      <HoldButton onTrigger={() => step(ei, si, 'reps', 1)}>+</HoldButton>
                    </div>
                  )}

                  <button className="link-btn danger small" onClick={() => removeSet(ei, si)}>✕</button>
                </div>
              ))}

              <button className="btn ghost full" onClick={() => addSet(ei)}>
                + подход (повтор предыдущего)
              </button>
            </div>
            )
          })}

          {isNew && (
            <button className="btn outline full" onClick={() => setTplPickerOpen(true)}>
              📋 Выбрать шаблон
            </button>
          )}

          <button className="btn outline full" onClick={openAddPicker}>
            + Добавить упражнение
          </button>

          <button className="btn primary full save-btn" disabled={!canSave} onClick={save}>
            {saving ? 'Сохранение…' : `Сохранить${totalSets ? ` (${totalSets})` : ''}`}
          </button>

          {!isNew && (
            <button className="link-btn full-link" disabled={saving} onClick={exportOne}>
              ⬇ Экспорт в JSON
            </button>
          )}

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
          title={replaceIdx != null ? 'Заменить упражнение' : 'Упражнение'}
          onPick={handlePick}
          onCreate={createExercise}
          onClose={closePicker}
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
