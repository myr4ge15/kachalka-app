import HoldButton from './HoldButton.jsx'
import TimeInput from './TimeInput.jsx'
import { exerciseMetric, isCountMetric, fmtSet } from '../lib/metric.js'
import { resolveProgSettings } from '../lib/progression.js'
import {
  daysAgoLabel, progArrow, progTone, nextProgStep, fmtProgStep,
} from '../lib/progressionCard.js'
import { exerciseFocusSummary } from '../lib/workoutFocus.js'
import { FEELS, FEEL_LABELS } from '../lib/rpe.js'

// Карточка одного упражнения в композере тренировки (шапка, панель автопрогрессии
// .ap, таблица подходов, «+ подход»). Чисто презентационная: весь стейт и его
// апдейтеры приходят колбэками. `active`/`onActivate(exerciseId)` — контракт
// фокус-режима: активная карточка развернута, остальные сворачиваются в сводку.
// `prog` — live-query настроек прогрессии (для resolveProgSettings в панели
// настроек), `ei` — индекс записи (ключ существующих апдейтеров).
// Отметок «подход выполнен» нет с v6.1.0: что в строках — то и записывается,
// подхода, которого не было, удаляется ✕. Слева в строке — просто номер подхода.
// `feel`/`onSetFeel` — субъективная оценка «как пошло» (RPE, Slice 4). В отличие
// от состава она живет отдельно: экран запишет ее в meta после сохранения
// тренировки. Оценка необязательна, поэтому строка ничего не требует и не
// блокирует, а повторный тап по выбранной кнопке снимает выбор.
export default function ExerciseCard({
  entry, ei, prog, active = true, cardRef = null, onActivate = () => {},
  feel = null, onSetFeel = () => {},
  onReplace, onRemove,
  onRevertProg, onApplyProg, onToggleProgSettings, onChangeProgSettings,
  onUpdateSet, onStep, onAddSet, onRemoveSet,
}) {
  const metric = exerciseMetric(entry.exercise)
  const count = isCountMetric(metric) // своего веса / на время — без столбца «кг»
  const isTime = metric === 'time'
  const valLabel = isTime ? 'мин:сек' : 'повт.'
  const summary = exerciseFocusSummary(entry)

  // Свернутое упражнение доступно одной крупной кнопкой со сводкой подходов.
  if (!active) {
    return (
      <div
        className={`card exercise-card exercise-card--compact${count ? ' count' : ''}`}
        data-exercise-id={entry.exercise.id}
        data-active="false"
      >
        <button
          type="button"
          className="exercise-compact-toggle"
          aria-expanded="false"
          aria-label={`Открыть ${entry.exercise.name}: ${summary.text}`}
          onClick={() => onActivate(entry.exercise.id)}
        >
          <span className="exercise-compact-copy">
            <strong>{entry.exercise.name}</strong>
            <span className={`muted${summary.setCount === 0 ? ' warn' : ''}`}>{summary.text}</span>
          </span>
          <svg className="exercise-compact-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div
      ref={cardRef}
      className={`card exercise-card exercise-card--active${count ? ' count' : ''}`}
      data-exercise-id={entry.exercise.id}
      data-active={active ? 'true' : 'false'}
      onPointerDown={() => onActivate(entry.exercise.id)}
      onFocusCapture={() => onActivate(entry.exercise.id)}
    >
      <div className="exercise-head">
        <span className="exercise-title">
          <span className="exercise-name">{entry.exercise.name}</span>
        </span>
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
              ><GearIcon /></button>
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
                ><GearIcon /></button>
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
          {/* Номер подхода — просто подпись (v6.1.0): отметок выполнения больше
              нет, колонка узкая, ширина уходит степперам. */}
          <span className="set-no" aria-hidden="true">{si + 1}</span>

          {!count && (
            <div className="stepper" role="group" aria-label={`Подход ${si + 1}, вес`}>
              <HoldButton onTrigger={() => onStep(ei, si, 'weight', -1.25)}>−</HoldButton>
              <input
                type="text" inputMode="decimal" value={s.weight}
                aria-label={`Вес, подход ${si + 1}`}
                onChange={(e) => onUpdateSet(ei, si, 'weight', e.target.value.replace(',', '.'))}
              />
              <HoldButton onTrigger={() => onStep(ei, si, 'weight', 1.25)}>+</HoldButton>
            </div>
          )}

          {isTime ? (
            <div className="stepper" role="group" aria-label={`Подход ${si + 1}, время`}>
              <HoldButton onTrigger={() => onStep(ei, si, 'reps', -5)}>−</HoldButton>
              <TimeInput
                value={s.reps}
                aria-label={`Время, подход ${si + 1}`}
                onChange={(sec) => onUpdateSet(ei, si, 'reps', sec)}
              />
              <HoldButton onTrigger={() => onStep(ei, si, 'reps', 5)}>+</HoldButton>
            </div>
          ) : (
            <div className="stepper" role="group" aria-label={`Подход ${si + 1}, повторения`}>
              <HoldButton onTrigger={() => onStep(ei, si, 'reps', -1)}>−</HoldButton>
              <input
                type="number" inputMode="numeric" value={s.reps}
                aria-label={`Повторения, подход ${si + 1}`}
                onChange={(e) => onUpdateSet(ei, si, 'reps', e.target.value)}
              />
              <HoldButton onTrigger={() => onStep(ei, si, 'reps', 1)}>+</HoldButton>
            </div>
          )}

          <button className="set-rm" onClick={() => onRemoveSet(ei, si)} aria-label={`Удалить подход ${si + 1}`}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      ))}

      <button className="set-add" onClick={() => onAddSet(ei)}>
        + подход (повтор предыдущего)
      </button>

      {/* Оценка идет ПОСЛЕ подходов и «+ подход» — по хронологии занятия:
          сначала делаешь упражнение, потом говоришь, как оно пошло. */}
      <div className="feel" role="group" aria-label={`Как пошло: ${entry.exercise.name}`}>
        <span className="feel-lbl">Как пошло?</span>
        <div className="feel-btns">
          {FEELS.map((f) => (
            <button
              key={f}
              type="button"
              className={`feel-btn feel-${f}${feel === f ? ' on' : ''}`}
              aria-pressed={feel === f}
              onClick={() => onSetFeel(entry.exercise.id, f)}
            >
              {FEEL_LABELS[f]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}
