import HoldButton from './HoldButton.jsx'
import { exerciseMetric, isCountMetric, fmtSet, fmtTime, parseTime } from '../lib/metric.js'
import { resolveProgSettings } from '../lib/progression.js'
import {
  daysAgoLabel, progArrow, progTone, nextProgStep, fmtProgStep,
} from '../lib/progressionCard.js'
import { exerciseFocusSummary } from '../lib/workoutFocus.js'
import { isSetDone } from '../lib/setCompletion.js'
import { plural, pluralize } from '../lib/plural.js'

// Карточка одного упражнения в композере тренировки (шапка, панель автопрогрессии
// .ap, таблица подходов, «+ подход»). Чисто презентационная: весь стейт и его
// апдейтеры приходят колбэками. `active`/`onActivate(exerciseId)` — контракт
// фокус-режима: активная карточка развёрнута, остальные сворачиваются в сводку.
// `prog` — live-query настроек прогрессии (для resolveProgSettings в панели
// настроек), `ei` — индекс записи (ключ существующих апдейтеров).
// `doneKeys`/`onToggleSetDone` — явные отметки выполнения подходов (Slice 2):
// транзиентное состояние экрана, в документ тренировки не попадает.
// `dropUnchecked` — режим правки сохранённой тренировки: там карточка открыта
// «всё выполнено», поэтому снятая отметка означает «подхода не было» и он не
// попадёт в запись при сохранении. Строку помечаем ДО сохранения, чтобы
// случайный тап не удалял данные молча.
export default function ExerciseCard({
  entry, ei, prog, active = true, cardRef = null, onActivate = () => {},
  doneKeys = null, onToggleSetDone = () => {}, dropUnchecked = false,
  onReplace, onRemove,
  onRevertProg, onApplyProg, onToggleProgSettings, onChangeProgSettings,
  onUpdateSet, onStep, onAddSet, onRemoveSet,
}) {
  const metric = exerciseMetric(entry.exercise)
  const count = isCountMetric(metric) // своего веса / на время — без столбца «кг»
  const isTime = metric === 'time'
  const valLabel = isTime ? 'мин:сек' : 'повт.'
  const summary = exerciseFocusSummary(entry, doneKeys)
  // Сколько подходов выпадет из записи при сохранении (только режим правки).
  const skipCount = dropUnchecked ? summary.setCount - summary.doneCount : 0

  // Свёрнутое упражнение доступно одной крупной кнопкой. Сводка отвечает на
  // «выполнено или нет» ТОЛЬКО по явным отметкам: заполненные значения могли
  // приехать из шаблона или автопрогрессии.
  if (!active) {
    return (
      <div
        className={`card exercise-card exercise-card--compact${count ? ' count' : ''}${summary.allDone ? ' exercise-card--done' : ''}`}
        data-exercise-id={entry.exercise.id}
        data-active="false"
        data-done={summary.allDone ? 'true' : 'false'}
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
            <span className={`muted${summary.allDone ? ' done' : ''}`}>{summary.text}</span>
          </span>
          <span className="exercise-compact-chevron" aria-hidden="true">›</span>
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
          <span className="exercise-active-badge">сейчас</span>
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

      {entry.sets.map((s, si) => {
        const done = isSetDone(doneKeys, entry.exercise.id, s, si)
        const skipped = dropUnchecked && !done
        return (
          <div
            key={s._k ?? si}
            className={`set-row${done ? ' set-row--done' : ''}${skipped ? ' set-row--skip' : ''}`}
          >
            {/* Номер подхода — он же отметка выполнения: зона тапа 44×44 без
                отдельного столбца, поэтому степперы не теряют ширину. */}
            <button
              type="button"
              className={`set-done${done ? ' on' : ''}`}
              aria-pressed={done}
              aria-label={done
                ? `Подход ${si + 1} выполнен`
                : skipped
                  ? `Подход ${si + 1} не выполнен и не сохранится — отметить выполненным`
                  : `Отметить подход ${si + 1} выполненным`}
              onClick={() => onToggleSetDone(entry.exercise.id, s, si)}
            >
              <span aria-hidden="true">{done ? '✓' : si + 1}</span>
            </button>

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
        )
      })}

      {/* Явное предупреждение вместо молчаливой потери: в правке снятая отметка
          выбрасывает подход из записи, а снятые у всех подходов — упражнение. */}
      {skipCount > 0 && (
        <p className="sets-skip-note" role="status">
          {skipCount === entry.sets.length
            ? 'Ни один подход не отмечен — упражнение не сохранится.'
            : `${pluralize(skipCount, 'подход', 'подхода', 'подходов')} без отметки ${plural(skipCount, 'не сохранится', 'не сохранятся', 'не сохранятся')}.`}
        </p>
      )}

      <button className="btn ghost full" onClick={() => onAddSet(ei)}>
        + подход (повтор предыдущего)
      </button>
    </div>
  )
}
