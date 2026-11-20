import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getExercises, getFavorites, toggleFavorite } from '../../db/repo.js'
import { hasNewDraft, startNewDraftFrom } from '../../hooks/useWorkoutDraft.js'
import { readDraft, writeDraft } from '../../lib/draftStore.js'
import { defaultSet } from '../../lib/progressionCard.js'
import { exerciseUsageSections } from '../../lib/exerciseUsage.js'
import { techniqueSlugFor } from '../../lib/technique.js'
import ExercisePicker from '../exercises/ExercisePicker.jsx'
import MenuRow from '../ui/MenuRow.jsx'
import SheetDialog from '../ui/SheetDialog.jsx'
import Icon from '../ui/Icon.jsx'

export default function NextWorkoutPlan({ userId, workouts, onStart }) {
  const key = `workout_plan_${userId}`
  const [plan, setPlan] = useState(() => readDraft(key) ?? [])
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const exercises = useLiveQuery(() => picking ? getExercises() : [], [picking, userId], [])
  const favorites = useLiveQuery(() => picking ? getFavorites(userId) : [], [picking, userId], [])
  const usage = useMemo(() => picking ? exerciseUsageSections(workouts ?? []) : undefined, [picking, workouts])
  const occupied = open && hasNewDraft(userId)

  function save(next) {
    writeDraft(key, next)
    setPlan(next)
  }

  function add(chosen) {
    save([...new Map([...plan, ...chosen].map(ex => [ex.id, ex])).values()])
    setPicking(false)
  }

  function start() {
    if (!hasNewDraft(userId)) {
      const entries = plan.map(exercise => ({ exercise, sets: [defaultSet(exercise)] }))
      startNewDraftFrom(userId, entries)
      save([])
    }
    setOpen(false)
    onStart()
  }

  return <>
    <MenuRow icon="calendar" title="Запланировать тренировку" badge={plan.length || null}
      onClick={() => setOpen(true)} />
    {open && <SheetDialog title="Запланировать тренировку" className="sheet--compact next-plan" onDismiss={() => setOpen(false)} swipeBack swipeDown>
      <div className="sheet-scroll">
        {plan.length === 0 && <p className="muted">Добавь упражнения для следующей тренировки. План сохранится на этом устройстве.</p>}
        {plan.length > 0 && <ul className="next-plan-list">{plan.map(ex => <li className="next-plan-row" key={ex.id}>
          <span className="next-plan-exercise">{ex.name}</span>
          <button type="button" className="btn ghost btn--sm" aria-label={`Убрать «${ex.name}» из плана`}
            onClick={() => save(plan.filter(item => item.id !== ex.id))}><Icon name="trash" /></button>
        </li>)}</ul>}
        <button type="button" className="add-btn" onClick={() => setPicking(true)}>
          <Icon name="plus" /> Добавить упражнения
        </button>
      </div>
      {plan.length > 0 && <>
        {occupied && <p className="muted">План сохранён. Его можно начать после текущей тренировки.</p>}
        <div className="btn-row"><button className="btn primary" onClick={start}>
          {occupied ? 'Вернуться к текущей тренировке' : 'Начать'}
        </button></div>
      </>}
    </SheetDialog>}
    {picking && <ExercisePicker exercises={exercises} title="Упражнения для плана" selectMany
      usage={usage} favorites={favorites} onToggleFavorite={id => toggleFavorite(userId, id)}
      techniqueSlugOf={techniqueSlugFor} techniqueAtName
      onPick={ex => add([ex])} onPickMany={add} onClose={() => setPicking(false)} />}
  </>
}
