import SheetDialog from '../ui/SheetDialog.jsx'
import CheckIcon from '../ui/CheckIcon.jsx'
import Icon from '../ui/Icon.jsx'
import { fmtTonnage } from '../../lib/profileStats.js'
import { fmtTime, fmtSetList } from '../../lib/metric.js'
import { entryMetric, mainEntries } from '../../lib/entries.js'
import { formatWorkoutDuration, workoutFinishSummary } from '../../lib/workoutFinish.js'

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
    <SheetDialog title="Тренировка готова" onDismiss={onDone} swipeDown>
      <div className={`workout-finish${mainEvent?.celebrated ? ' has-celebration' : ''}`}>
        <div className="workout-finish-mark" aria-hidden="true"><CheckIcon size={38} strokeWidth={3} /></div>
        <p className="workout-finish-lead">Записали. Можно выдохнуть.</p>

        <dl className="workout-finish-stats">
          <div>
            <dt>Упражнения</dt>
            <dd>{summary.exerciseCount}</dd>
          </div>
          <div>
            <dt>{summary.blocks ? 'Рабочие подходы' : 'Подходы'}</dt>
            <dd>{summary.workingSets ?? summary.setCount}</dd>
          </div>
          {summary.blocks > 0 && <div><dt>Повторения</dt><dd>{summary.repetitions}</dd></div>}
          {/* Без веса (свой вес, время, дистанция) «Тоннаж 0 кг» ничего не говорит — плитку прячем (UI-ревью 23.10). */}
          {summary.tonnage > 0 && (
            <div>
              <dt>Тоннаж</dt>
              <dd>{summary.blocks ? Math.round(summary.tonnage).toLocaleString('ru-RU') : tonnage.value} <span>{summary.blocks ? 'кг' : tonnage.unit}</span></dd>
            </div>
          )}
          {summary.timeUnderLoad > 0 && (
            <div>
              <dt>Под нагрузкой</dt>
              <dd>{fmtTime(summary.timeUnderLoad)}</dd>
            </div>
          )}
          {duration && (
            <div>
              <dt>Время</dt>
              <dd>{duration}</dd>
            </div>
          )}
        </dl>
        {summary.blocks > 0 && <>
          <p className="muted">{summary.blocks === summary.workingSets ? 'Все подходы записаны по номерам блоков.' :
            summary.blocks === summary.loadSets ? 'Для весовых упражнений записаны только номера блоков.' :
            `В тоннаж вошли подходы с известным весом (${summary.loadSets - summary.blocks} из ${summary.loadSets}). В остальных указан номер блока.`}</p>
          <details><summary>Подходы по упражнениям</summary>
            {mainEntries(workout).map((e, i) => <p key={i}><strong>{e.exercise?.name}</strong> · {fmtSetList(entryMetric(e), e.sets, ' · ')}</p>)}
          </details>
        </>}

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
            {templateDone
              ? <><CheckIcon size={16} strokeWidth={3} /> Шаблон создан</>
              : templateBusy ? 'Создаем шаблон…' : <><Icon name="template" size={18} /> Сохранить как шаблон</>}
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
