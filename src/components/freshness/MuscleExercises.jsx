import { useId, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getExercises } from '../../db/repo.js'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import { defaultSubmuscleFor } from '../../lib/muscles.js'
import MenuRow from '../ui/MenuRow.jsx'

function ExerciseNames({ submuscle }) {
  const exercises = useLiveQuery(getExercises, [])
  if (!exercises) return <p className="muted">Загружаем упражнения…</p>
  const matches = exercises.filter((ex) => (ex.submuscle || defaultSubmuscleFor(ex.muscle_group)) === submuscle)
  if (!matches.length) return <p className="muted">В каталоге пока нет упражнений на эту мышцу.</p>
  return <ul>{matches.map((ex) => <li key={ex.id}>{ex.name}</li>)}</ul>
}

export default function MuscleExercises({ submuscle }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const revealRef = useRevealFocus(open)
  return (
    <div className="menu-group fr-exercises">
      <MenuRow ref={revealRef} title={open ? 'Скрыть упражнения' : 'Показать упражнения'}
        kind="expand" open={open} aria-controls={panelId} onClick={() => setOpen(!open)} />
      <div id={panelId} hidden={!open} aria-live="polite">
        {open && <ExerciseNames submuscle={submuscle} />}
      </div>
    </div>
  )
}
