import SheetDialog from './SheetDialog.jsx'
import { fmtTonnage } from '../lib/profileStats.js'
import { formatWorkoutDuration, workoutFinishSummary } from '../lib/workoutFinish.js'

export default function WorkoutFinishSheet({
  workout,
  events = [],
  onDone,
  onOpenProgress,
  onCreateTemplate,
  templateStatus = 'idle',
  templateMessage = null,
}) {
  const summary = workoutFinishSummary(workout)
  const tonnage = fmtTonnage(summary.tonnage)
  const duration = formatWorkoutDuration(summary.durationSeconds)
  const mainEvent = events[0] ?? null
  const extraEvents = events.slice(1, 3)
  const templateBusy = templateStatus === 'busy'
  const templateDone = templateStatus === 'done'

  return (
    <SheetDialog title="Тренировка готова" onDismiss={onDone}>
      <div className={`workout-finish${mainEvent?.celebrated ? ' has-celebration' : ''}`}>
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

        {mainEvent && (
          <div className={`workout-finish-event event-${mainEvent.kind}`}>
            <span className="workout-finish-event-emoji" aria-hidden="true">{mainEvent.emoji}</span>
            <div>
              <strong>{mainEvent.title}</strong>
              <p>{mainEvent.text}</p>
            </div>
          </div>
        )}

        {extraEvents.length > 0 && (
          <ul className="workout-finish-more" aria-label="Другие результаты">
            {extraEvents.map((event) => (
              <li key={`${event.kind}:${event.title}`}>
                <span aria-hidden="true">{event.emoji}</span>
                <span><strong>{event.title}</strong> {event.text}</span>
              </li>
            ))}
          </ul>
        )}

        {mainEvent?.exerciseId && onOpenProgress && (
          <button
            className="btn primary full workout-finish-progress"
            data-autofocus
            onClick={() => onOpenProgress(mainEvent.exerciseId)}
          >
            Посмотреть прогресс
          </button>
        )}

        {onCreateTemplate && (
          <button
            className="btn outline full workout-finish-template"
            disabled={templateBusy || templateDone}
            onClick={onCreateTemplate}
          >
            {templateDone ? '✓ Шаблон создан' : templateBusy ? 'Создаём шаблон…' : '📋 Сохранить как шаблон'}
          </button>
        )}

        {templateMessage && (
          <p
            className={`workout-finish-template-msg${templateStatus === 'error' ? ' error' : ''}`}
            role={templateStatus === 'error' ? 'alert' : 'status'}
          >
            {templateMessage}
          </p>
        )}

        <button
          className={`btn full workout-finish-done${mainEvent?.exerciseId ? ' outline' : ' primary'}`}
          data-autofocus={!mainEvent?.exerciseId || !onOpenProgress || undefined}
          onClick={onDone}
        >
          Готово
        </button>
      </div>
    </SheetDialog>
  )
}
