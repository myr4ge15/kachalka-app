import { useEffect, useRef, useState } from 'react'
import { readGoals, writeGoals } from '../../db/notifications.js'
import { syncNow } from '../../db/sync.js'
import { normMetric, parseTime, fmtTime } from '../../lib/metric.js'
import { showToast } from '../Toast.jsx'
import HoldButton from '../HoldButton.jsx'
import GoalsList from '../GoalsList.jsx'
import { useAliveRef } from '../../hooks/useAliveRef.js'

// «Мои цели» в Профиле: список + инлайн-редактор (мульти-цели, фаза 2c; вынесено из
// ProfileScreen в v6.14.1). Цель любой метрики (вес/повторы/время); при сохранении
// сразу пушим (онлайн), чтобы Telegram-бот увидел цель до ближайшей тренировки.
// Пропсы: userId, goals (readGoals, с tombstone'ами), records (personalRecords), workouts.

// Степпер значения цели: −/+ с удержанием и слот под инпут+единицу (children).
// Раньше верстка .goal-stepper дублировалась для веса/повторов/времени.
function GoalStepper({ onDec, onInc, children }) {
  return (
    <div className="goal-stepper">
      <HoldButton onTrigger={onDec}>−</HoldButton>
      <span className="val">{children}</span>
      <HoldButton onTrigger={onInc}>+</HoldButton>
    </div>
  )
}

export default function GoalsSection({ userId, goals, records, workouts }) {
  const aliveRef = useAliveRef()

  // ── Редактор целей (мульти-цели, фаза 2c) ──────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [edExId, setEdExId] = useState(null)
  // Цель любой метрики: edMetric — тип ('weight'/'reps'/'time'), edVal — целевое
  // ведущее значение в единицах метрики (кг / повторы / секунды). edTimeStr —
  // отдельная строка ввода для time (мм:сс), чтобы не реформатить при наборе.
  const [edMetric, setEdMetric] = useState('weight')
  const [edVal, setEdVal] = useState(100)
  const [edTimeStr, setEdTimeStr] = useState('1:00')
  // Необязательные повторы при целевом весе (PLAN-goal-reps) — только у весовой
  // цели. 0/'' → требования по повторам нет (старое поведение).
  const [edReps, setEdReps] = useState(0)
  const [edIsNew, setEdIsNew] = useState(false) // добавляем новую (можно выбрать упражнение) или правим цель существующей

  // Редактор рендерится инлайн в секции «Мои цели» (вверху экрана). Если открыть
  // его, проскроллив вниз (кнопка «+ Добавить цель»), форма встает на месте секции
  // — выше видимой области. Доводим форму до экрана после ее появления.
  const editorRef = useRef(null)
  useEffect(() => {
    if (editing) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [editing])

  // Видимые цели (без tombstone'ов) и упражнения, по которым цели еще нет
  // (для пикера «добавить»). Имя редактируемой цели — из самого списка.
  const goalList = (goals ?? []).filter((g) => !g._deleted)
  // Цели — по любой метрике (вес/повторы/время): предлагаем все упражнения из
  // рекордов, по которым цели еще нет.
  // Дистанцию (бег, эллипс) в цели не берем (v6.12.0): серверные цели знают
  // только вес/повторы/время, а «пробежать N км» — отдельная история.
  const addOptions = records.filter(
    (r) => r.metric !== 'distance' && !goalList.some((g) => g.exerciseId === r.exId)
  )
  const edName = edExId
    ? (goalList.find((g) => g.exerciseId === edExId)?.exerciseName ??
       records.find((r) => r.exId === edExId)?.name ?? '—')
    : '—'

  // Разумный дефолт цели «чуть выше текущего» по метрике (base — текущий рекорд).
  function goalDefault(metric, base) {
    const b = Number(base) || 0
    const m = normMetric(metric)
    if (m === 'time') return Math.max(Math.round(b) + 15, 30)   // +15 с, минимум 0:30
    if (m === 'reps') return Math.max(Math.round(b) + 2, 5)     // +2 повтора, минимум 5
    return Math.max(b + 5, 20)                                  // +5 кг, минимум 20
  }
  // Установить редактируемое значение (секунды для time дублируем в строку мм:сс).
  function setEdValue(metric, v) {
    const m = normMetric(metric)
    const n = m === 'weight' ? v : Math.max(0, Math.round(Number(v) || 0))
    setEdVal(n)
    if (m === 'time') setEdTimeStr(fmtTime(n))
  }

  // Открыть редактор: новая цель (выбор упражнения из еще-без-цели) или правка
  // существующей (упражнение фиксировано).
  function openAddGoal() {
    if (addOptions.length === 0) {
      showToast({ emoji: '🎯', title: 'Цели уже на всех упражнениях' })
      return
    }
    const base = addOptions.find((r) => r.isBench) || addOptions[0]
    const m = normMetric(base?.metric)
    setEdIsNew(true)
    setEdExId(base?.exId ?? null)
    setEdMetric(m)
    setEdValue(m, goalDefault(m, base?.value ?? 0))
    setEdReps(0) // повторы по умолчанию не требуем
    setEditing(true)
  }
  // Смена упражнения в пикере новой цели → подхватываем его метрику и дефолт.
  function chooseGoalExercise(exId) {
    const r = addOptions.find((x) => String(x.exId) === String(exId))
    const m = normMetric(r?.metric)
    setEdExId(r?.exId ?? exId)
    setEdMetric(m)
    setEdValue(m, goalDefault(m, r?.value ?? 0))
    setEdReps(0)
  }
  function openEditGoal(g) {
    const m = normMetric(g.metric)
    setEdIsNew(false)
    setEdExId(g.exerciseId)
    setEdMetric(m)
    setEdValue(m, g.targetWeight)
    setEdReps(Number(g.targetReps) > 0 ? Math.round(Number(g.targetReps)) : 0)
    setEditing(true)
  }

  async function saveGoal() {
    if (!edExId) return
    const ex = records.find((r) => r.exId === edExId)
    const metric = normMetric(edMetric)
    // целевое значение в единицах метрики: вес — десятые, повторы/время — целое.
    const target =
      metric === 'weight' ? Math.round((Number(edVal) || 0) * 10) / 10 : Math.max(0, Math.round(Number(edVal) || 0))
    // Защита от «сохранил с непрожатым полем»: на мобильной клавиатуре тап по
    // «Сохранить» без blur оставляет edVal пустой строкой → Number('')→0 молча
    // записал бы бессмысленную цель в 0. Цель ≤ 0 не сохраняем (оставляем диалог).
    if (!(target > 0)) return
    // Повторы при целевом весе — только у весовой цели; 0/'' → нет требования (null).
    const reps = metric === 'weight' && Number(edReps) > 0 ? Math.round(Number(edReps)) : null
    const list = await readGoals(userId) // свежий массив (вкл. tombstone'ы)
    const idx = list.findIndex((g) => g.exerciseId === edExId)
    let next
    if (idx >= 0) {
      const prevW = Number(list[idx].targetWeight)
      const prevR = Number(list[idx].targetReps) || 0
      // смена веса ИЛИ повторов → цель можно достичь заново; иначе не сбрасываем.
      const changed = prevW !== target || prevR !== (reps || 0)
      next = list.map((g, i) =>
        i === idx
          ? {
              ...g,
              exerciseName: ex?.name ?? g.exerciseName ?? '—',
              metric,
              targetWeight: target,
              targetReps: reps,
              _dirty: 1,
              _deleted: 0,
              achievedAt: changed ? null : g.achievedAt ?? null,
            }
          : g
      )
    } else {
      next = [
        ...list,
        { exerciseId: edExId, exerciseName: ex?.name ?? '—', metric, targetWeight: target, targetReps: reps, achievedAt: null, _dirty: 1 },
      ]
    }
    await writeGoals(userId, next)
    if (aliveRef.current) setEditing(false)
    // Сразу пушим (если онлайн), чтобы бот увидел цель до ближайшей тренировки.
    if (navigator.onLine) syncNow(userId)
  }

  // Удалить цель: tombstone (_deleted+_dirty) — синк отправит delete_my_goal и
  // выкинет ее из массива; из списка пропадает сразу.
  async function deleteGoal(exerciseId) {
    const list = await readGoals(userId)
    const next = list.map((g) =>
      g.exerciseId === exerciseId ? { ...g, _deleted: 1, _dirty: 1 } : g
    )
    await writeGoals(userId, next)
    if (aliveRef.current) setEditing(false)
    if (navigator.onLine) syncNow(userId)
  }


  return (
    <section className="sec">
      <p className="sec-title">Мои цели</p>
      {editing ? (
        <div className="goal">
          <div className="goal-editor" ref={editorRef}>
            {edIsNew ? (
              <label className="field">
                <span className="field-lab">Упражнение</span>
                <select
                  className="prog-select"
                  value={String(edExId ?? '')}
                  onChange={(e) => chooseGoalExercise(e.target.value)}
                >
                  {addOptions.map((r) => (
                    <option key={r.exId} value={String(r.exId)}>
                      {r.name}{r.isBench ? ' 🏅' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="field">
                <span className="field-lab">Упражнение</span>
                <div className="goal-editor-ex">{edName}</div>
              </div>
            )}
            <label className="field">
              <span className="field-lab">
                {edMetric === 'time' ? 'Цель (время)' : edMetric === 'reps' ? 'Цель (повторения)' : 'Целевой вес'}
              </span>
              {edMetric === 'weight' ? (
                <GoalStepper
                  onDec={() => setEdVal((w) => Math.max(1.5, Math.round((Number(w) - 1.5) * 10) / 10))}
                  onInc={() => setEdVal((w) => Math.round((Number(w) + 1.5) * 10) / 10)}
                >
                  <input
                    className="val-field"
                    type="text"
                    inputMode="decimal"
                    value={edVal}
                    onChange={(e) =>
                      setEdVal(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))
                    }
                    onBlur={() =>
                      setEdVal((w) => {
                        const n = Number(w)
                        return n > 0 ? Math.round(n * 10) / 10 : 2.5
                      })
                    }
                    aria-label="Целевой вес в килограммах"
                  />
                  <span className="u">кг</span>
                </GoalStepper>
              ) : edMetric === 'reps' ? (
                <GoalStepper
                  onDec={() => setEdVal((v) => Math.max(1, Math.round(Number(v) || 0) - 1))}
                  onInc={() => setEdVal((v) => Math.round(Number(v) || 0) + 1)}
                >
                  <input
                    className="val-field"
                    type="text"
                    inputMode="numeric"
                    value={edVal}
                    onChange={(e) => setEdVal(e.target.value.replace(/[^\d]/g, ''))}
                    onBlur={() => setEdVal((v) => Math.max(1, Math.round(Number(v) || 0)))}
                    aria-label="Целевое число повторений"
                  />
                  <span className="u">повт.</span>
                </GoalStepper>
              ) : (
                <GoalStepper
                  onDec={() => setEdVal((v) => { const n = Math.max(5, Math.round(Number(v) || 0) - 5); setEdTimeStr(fmtTime(n)); return n })}
                  onInc={() => setEdVal((v) => { const n = Math.round(Number(v) || 0) + 5; setEdTimeStr(fmtTime(n)); return n })}
                >
                  <input
                    className="val-field"
                    type="text"
                    inputMode="numeric"
                    value={edTimeStr}
                    onChange={(e) => { setEdTimeStr(e.target.value); setEdVal(parseTime(e.target.value)) }}
                    onBlur={() => { const n = parseTime(edTimeStr); setEdVal(n); setEdTimeStr(fmtTime(n)) }}
                    aria-label="Целевое время в формате минуты:секунды"
                  />
                  <span className="u">мин:сек</span>
                </GoalStepper>
              )}
            </label>
            {edMetric === 'weight' && (
              <label className="field">
                <span className="field-lab">Повторения при этом весе <span className="muted">(необязательно)</span></span>
                <GoalStepper
                  onDec={() => setEdReps((v) => Math.max(0, Math.round(Number(v) || 0) - 1))}
                  onInc={() => setEdReps((v) => Math.round(Number(v) || 0) + 1)}
                >
                  <input
                    className="val-field"
                    type="text"
                    inputMode="numeric"
                    value={edReps ? String(edReps) : ''}
                    placeholder="—"
                    onChange={(e) => setEdReps(e.target.value.replace(/[^\d]/g, ''))}
                    onBlur={() => setEdReps((v) => Math.max(0, Math.round(Number(v) || 0)))}
                    aria-label="Повторения при целевом весе (необязательно)"
                  />
                  <span className="u">повт.</span>
                </GoalStepper>
              </label>
            )}
            <div className="goal-editor-actions">
              {!edIsNew && (
                <button className="btn danger-ghost" onClick={() => deleteGoal(edExId)}>Удалить</button>
              )}
              <button className="btn ghost" onClick={() => setEditing(false)}>Отмена</button>
              <button className="btn primary" onClick={saveGoal} disabled={!edExId}>Сохранить</button>
            </div>
          </div>
        </div>
      ) : goalList.length === 0 ? (
        <div className="goal">
          <button className="goal-edit set" onClick={openAddGoal}>+ Поставить цель</button>
        </div>
      ) : (
        <GoalsList goalList={goalList} workouts={workouts} onEdit={openEditGoal} onAdd={openAddGoal} />
      )}
    </section>
  )
}
