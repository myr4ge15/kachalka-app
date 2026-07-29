import SheetDialog from './SheetDialog.jsx'
import { fmtTonnage } from '../lib/profileStats.js'
import { formatWorkoutDuration, workoutFinishSummary } from '../lib/workoutFinish.js'

export default function WorkoutFinishSheet({ workout, onDone }) {
  const summary = workoutFinishSummary(workout)
  const tonnage = fmtTonnage(summary.tonnage)
  const duration = formatWorkoutDuration(summary.durationSeconds)

  return (
    <SheetDialog title="Тренировка готова" onDismiss={onDone}>
      <div className="workout-finish">
        <div className="workout-finish-mark" aria-hidden="true">✓</div>
        <p className="workout-finish-lead">Записали. Можно выдохнуть.</p>

        <dl className="workout-finish-stats">
          <div>
            <dt>Упражнения</dt>
            <dd>{summary.exerciseCount}</dd>
          </div>
          <div>
            <dt>Подходы</dt>
            <dd>{summary.setCount}</dd>
          </div>
          <div>
            <dt>Тоннаж</dt>
            <dd>{tonnage.value} <span>{tonnage.unit}</span></dd>
          </div>
          {duration && (
            <div>
              <dt>Время</dt>
              <dd>{duration}</dd>
            </div>
          )}
        </dl>

        <button className="btn primary full workout-finish-done" data-autofocus onClick={onDone}>
          Готово
        </button>
      </div>
    </SheetDialog>
  )
}
