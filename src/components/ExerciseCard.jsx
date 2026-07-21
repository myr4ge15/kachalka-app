import HoldButton from './HoldButton.jsx'
import { exerciseMetric, isCountMetric, fmtSet, fmtTime, parseTime } from '../lib/metric.js'
import { resolveProgSettings } from '../lib/progression.js'
import {
  daysAgoLabel, progArrow, progTone, nextProgStep, fmtProgStep,
} from '../lib/progressionCard.js'

// Карточка одного упражнения в композере тренировки (шапка, панель автопрогрессии
// .ap, таблица подходов, «+ подход»). Чисто презентационная: весь стейт и его
// апдейтеры живут в WorkoutScreen, сюда приходят колбэками (техдолг: разбить
// WorkoutScreen на 800+ строк). `prog` — live-query настроек прогрессии (для
// resolveProgSettings в панели настроек), `ei` — индекс записи (ключ апдейтеров).
export default function ExerciseCard({
  entry, ei, prog,
  onReplace, onRemove,
  onRevertProg, onApplyProg, onToggleProgSettings, onChangeProgSettings,
  onUpdateSet, onStep, onAddSet, onRemoveSet,
}) {
  const metric = exerciseMetric(entry.exercise)
  const count = isCountMetric(metric) // своего веса / на время — без столбца «кг»
  const isTime = metric === 'time'
  const valLabel = isTime ? 'мин:сек' : 'повт.'

  return (
    <div className={`card exercise-card${count ? ' count' : ''}`}>
      <div className="exercise-head">
        <span className="exercise-name">{entry.exercise.name}</span>
        <span className="exercise-actions">
          <button className="link-btn" onClick={() => onReplace(ei)}>заменить</button>
          <button className="link-btn danger" onClick={() => onRemove(ei)}>убрать</button>
        </span>
      </div>

      {entry.prog && (
        <div className={`ap${entry.prog.muted ? ' ap-muted' : ''}`}>
          {entry.prog.muted ? (
            <div className="ap-muted-row">
              <span className="ap-muted-lbl">
                Прогрессия: {entry.prog.strategy === 'off' ? 'выключена' : 'ручной ввод'}
              </span>
              <button
                className={`btn-gear${entry.prog.settingsOpen ? ' on' : ''}`}
                aria-label="Настройки прогрессии"
                aria-expanded={entry.prog.settingsOpen}
                onClick={() => onToggleProgSettings(ei)}
              >⚙</button>
            </div>
          ) : (
            <>
              <div className="ap-row">
                <span className="ap-lbl">Прошлая</span>
                <span className="ap-when">{daysAgoLabel(entry.prog.whenIso)}</span>
              </div>
              <div className="ap-prev">
                {entry.prog.prev.map((s) => fmtSet(metric, s)).join(' · ')}
              </div>
              <div className={`ap-rec-lbl ${progTone(entry.prog.kind)}`}>
                {progArrow(entry.prog.kind)} Рекомендуем сегодня
              </div>
              <div className="ap-rec">
                {entry.prog.recSets.map((s) => fmtSet(metric, s)).join(' · ')}
              </div>
              <span className={`reason ${progTone(entry.prog.kind)}`}>{entry.prog.reason}</span>
              <div className="ap-actions">
                {entry.prog.applied ? (
                  <button className="link-btn ap-revert" onClick={() => onRevertProg(ei)}>
                    вернуть как в прошлый раз
                  </button>
                ) : (
                  <button className="btn-apply" onClick={() => onApplyProg(ei)}>Применить рекомендацию</button>
                )}
                <button
                  className={`btn-gear${entry.prog.settingsOpen ? ' on' : ''}`}
                  aria-label="Настройки прогрессии"
                  aria-expanded={entry.prog.settingsOpen}
                  onClick={() => onToggleProgSettings(ei)}
                >⚙</button>
              </div>
            </>
          )}
          {entry.prog.settingsOpen && (() => {
            const eff = resolveProgSettings(prog, entry.exercise.id, metric)
            return (
              <div className="ap-settings">
                <div className="seg" role="group" aria-label="Стратегия прогрессии">
                  {!count && (
                    <button className={`seg-item${eff.strategy === 'weight' ? ' on' : ''}`}
                      onClick={() => onChangeProgSettings(ei, { strategy: 'weight' })}>+вес</button>
                  )}
                  <button className={`seg-item${eff.strategy === 'reps' ? ' on' : ''}`}
                    onClick={() => onChangeProgSettings(ei, { strategy: 'reps' })}>{isTime ? '+сек' : '+повт.'}</button>
                  <button className={`seg-item${eff.strategy === 'manual' ? ' on' : ''}`}
                    onClick={() => onChangeProgSettings(ei, { strategy: 'manual' })}>ручной</button>
                  <button className={`seg-item${eff.strategy === 'off' ? ' on' : ''}`}
                    onClick={() => onChangeProgSettings(ei, { strategy: 'off' })}>выкл</button>
                </div>
                {(eff.strategy === 'weight' || eff.strategy === 'reps') && (
                  <div className="ap-step-line">
                    <span className="lbl">Шаг</span>
                    <div className="stepper ap-stepper">
                      <HoldButton onTrigger={() => onChangeProgSettings(ei, { step: nextProgStep(eff.step, metric, -1) })}>−</HoldButton>
                      <span className="ap-step-val">{fmtProgStep(eff.step, metric)}</span>
                      <HoldButton onTrigger={() => onChangeProgSettings(ei, { step: nextProgStep(eff.step, metric, +1) })}>+</HoldButton>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}

      <div className="sets-head">
        {count
          ? <><span>#</span><span>{valLabel}</span><span></span></>
          : <><span>#</span><span>кг</span><span>повт.</span><span></span></>}
      </div>

      {entry.sets.map((s, si) => (
        <div key={s._k ?? si} className="set-row">
          <span className="set-num">{si + 1}</span>

          {!count && (
            <div className="stepper">
              <HoldButton onTrigger={() => onStep(ei, si, 'weight', -1.25)}>−</HoldButton>
              <input
                type="text" inputMode="decimal" value={s.weight}
                onChange={(e) => onUpdateSet(ei, si, 'weight', e.target.value.replace(',', '.'))}
              />
              <HoldButton onTrigger={() => onStep(ei, si, 'weight', 1.25)}>+</HoldButton>
            </div>
          )}

          {isTime ? (
            <div className="stepper">
              <HoldButton onTrigger={() => onStep(ei, si, 'reps', -15)}>−</HoldButton>
              <input
                type="text" inputMode="numeric" value={fmtTime(s.reps)}
                onChange={(e) => onUpdateSet(ei, si, 'reps', parseTime(e.target.value))}
              />
              <HoldButton onTrigger={() => onStep(ei, si, 'reps', 15)}>+</HoldButton>
            </div>
          ) : (
            <div className="stepper">
              <HoldButton onTrigger={() => onStep(ei, si, 'reps', -1)}>−</HoldButton>
              <input
                type="number" inputMode="numeric" value={s.reps}
                onChange={(e) => onUpdateSet(ei, si, 'reps', e.target.value)}
              />
              <HoldButton onTrigger={() => onStep(ei, si, 'reps', 1)}>+</HoldButton>
            </div>
          )}

          <button className="link-btn danger small" onClick={() => onRemoveSet(ei, si)}>✕</button>
        </div>
      ))}

      <button className="btn ghost full" onClick={() => onAddSet(ei)}>
        + подход (повтор предыдущего)
      </button>
    </div>
  )
}
