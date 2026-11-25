import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getExercises, getFavorites } from '../../db/repo.js'
import { hasNewDraft, startNewDraftFrom } from '../../hooks/useWorkoutDraft.js'
import { readDraft, writeDraft } from '../../lib/draftStore.js'
import { planEntry, describeTarget } from '../../lib/planImport/draft.js'
import PlanImport from './PlanImport.jsx'
import { exerciseUsageSections } from '../../lib/exerciseUsage.js'
import { techniqueSlugFor } from '../../lib/technique.js'
import ExercisePicker from '../exercises/ExercisePicker.jsx'
import MenuRow from '../ui/MenuRow.jsx'
import SheetDialog from '../ui/SheetDialog.jsx'
import Icon from '../ui/Icon.jsx'

export default function NextWorkoutPlan({ userId, workouts, onStart }) {
  const key = `workout_plan_${userId}`
  const [stored, setStored] = useState(() => readDraft(key) ?? [])
  const plan = Array.isArray(stored) ? stored : stored.items
  const info = Array.isArray(stored) ? null : stored.info
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [importing, setImporting] = useState(false)
  const exercises = useLiveQuery(() => picking || importing ? getExercises() : [], [picking, importing, userId], [])
  const favorites = useLiveQuery(() => picking ? getFavorites(userId) : [], [picking, userId], [])
  const usage = useMemo(() => picking ? exerciseUsageSections(workouts ?? []) : undefined, [picking, workouts])
  const occupied = open && hasNewDraft(userId)

  function save(next, meta = info) {
    const value = meta && next.length ? { items: next, info: meta } : next
    writeDraft(key, value)
    setStored(value)
  }

  function add(chosen) {
    save([...plan, ...chosen.filter(ex => !plan.some(item => item.id === ex.id))])
    setPicking(false)
  }

  function start() {
    if (!hasNewDraft(userId)) {
      const entries = plan.map(planEntry)
      const context = [info?.name, info?.date, info?.notes, info?.context].filter(Boolean).join('\n')
      if (context && entries[0]) entries[0].planContext = context
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
        {info && <><p>{[info.name, info.date].filter(Boolean).join(' · ')}</p>
          {(info.notes || info.context) && <details><summary>Заметки к плану</summary><p className="plan-note">{[info.notes, info.context].filter(Boolean).join('\n')}</p></details>}</>}
        {plan.length === 0 && <p className="muted">Добавь упражнения для следующей тренировки. План сохранится на этом устройстве.</p>}
        {plan.length > 0 && <ul className="next-plan-list">{plan.map(ex => <li className="next-plan-row" key={ex.id}>
          <span className="next-plan-exercise">{ex.name}{ex.planTarget && <small className="plan-note">{ex.planTarget.sets.map(describeTarget).join(' / ')}</small>}</span>
          <button type="button" className="btn ghost btn--sm" aria-label={`Убрать «${ex.name}» из плана`}
            onClick={() => save(plan.filter(item => item.id !== ex.id))}><Icon name="trash" /></button>
        </li>)}</ul>}
        <button type="button" className="add-btn" onClick={() => setPicking(true)}>
          <Icon name="plus" /> Добавить упражнения
        </button>
        <button type="button" className="add-btn" onClick={() => setImporting(true)}><Icon name="upload" /> Вставить план</button>
      </div>
      {plan.length > 0 && <>
        {occupied && <p className="muted">План сохранён. Его можно начать после текущей тренировки.</p>}
        <div className="btn-row"><button className="btn primary" onClick={start}>
          {occupied ? 'Вернуться к текущей тренировке' : 'Начать'}
        </button></div>
      </>}
    </SheetDialog>}
    {picking && <ExercisePicker exercises={exercises} title="Упражнения для плана" selectMany
      usage={usage} favorites={favorites}
      techniqueSlugOf={techniqueSlugFor} techniqueAtName
      onPick={ex => add([ex])} onPickMany={add} onClose={() => setPicking(false)} />}
    {importing && <PlanImport catalog={exercises} workouts={workouts} replacing={plan.length > 0}
      onClose={() => setImporting(false)} onSave={(items, meta) => { save(items, meta); setImporting(false) }} />}
  </>
}
