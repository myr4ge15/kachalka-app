import { useState } from 'react'
import Chevron from '../ui/Chevron.jsx'
import HoldButton from '../ui/HoldButton.jsx'
import TimeInput from '../ui/TimeInput.jsx'
import { useSelectOnFocus } from '../../hooks/useSelectOnFocus.js'
import SetsCells from '../workout/SetsCells.jsx'
import SetVoice from '../workout/SetVoice.jsx'
import { VOICE_ENABLED } from '../../lib/features.js'
import { exerciseMetric, isCountMetric, hasExtraWeight, bestPace, fmtNum, fmtPace, paceSecPerKm } from '../../lib/metric.js'
import { resolveProgSettings } from '../../lib/progression.js'
import {
  daysAgoLabel, progArrow, progTone, nextProgStep, fmtProgStep,
} from '../../lib/progressionCard.js'
import { exerciseFocusSummary } from '../../lib/workoutFocus.js'
import { FEELS, FEEL_LABELS } from '../../lib/rpe.js'
import { TechniqueButton } from './TechniqueSheet.jsx'

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
// `onTechnique` (v8.0.0) — открыть подсказку «Как выполнять»; нет подсказки для
// упражнения — нет и кнопки. «i» стоит сразу за названием (внутри ручки
// перестановки, но с data-no-sort — удержание на ней строку не поднимает). Кнопка
// только у раскрытой карточки: она уже активна, pointerdown корня reveal не дает.
// `onVoiceSet(ei, si, {weight,reps})` (v8.7.0) — подход голосом: микрофон рядом с
// «+ подход» (только «вес × повторы» и «свой вес»), `voiceCursor` — строка, которую
// голос предложит по умолчанию. Нет колбэка или распознавания — нет и микрофона.
// `restSlot` (v8.8.1) — кнопка таймера отдыха в ряду с «+ подход»: таймер живет в
// карточке упражнения, а не в шапке тренировки (длинную тренировку не листать наверх);
// WorkoutScreen передает ее только раскрытой карточке новой тренировки за сегодня.
export default function ExerciseCard({
  entry, ei, prog, active = true, cardRef = null, onActivate = () => {},
  feel = null, onSetFeel = () => {},
  onTechnique = null,
  onReplace, onRemove,
  onRevertProg, onApplyProg, onToggleProgSettings, onChangeProgSettings,
  onUpdateSet, onStep, onAddSet, onRemoveSet,
  onVoiceSet = null, voiceCursor = 0,
  restSlot = null,
}) {
  const metric = exerciseMetric(entry.exercise)
  // «На время» — без столбца веса; у «своего веса» (v6.16.0) — столбец «±кг»: плюс —
  // доп. вес (пояс), минус — помощь гравитрона/резины (v7.2.0; «−» степпера уходит ниже 0).
  const extra = hasExtraWeight(metric)
  const count = isCountMetric(metric) && !extra
  // Дистанция (v6.12.0): столбцы «км» и «мин:сек»; темп считаем по ходу ввода.
  const isDistance = metric === 'distance'
  const isTime = metric === 'time' || isDistance
  const valLabel = isTime ? 'мин:сек' : 'повт.'
  const pace = isDistance ? bestPace(entry.sets) ?? lastPace(entry.sets) : null
  const summary = exerciseFocusSummary(entry)
  // Блок «Прошлая / Рекомендуем» (аудит 16.10): занимал ~40% карточки и после того, как
  // подходы уже правят. Рекомендация применена, а подходы с ней разошлись (человек ввел свое) —
  // сворачиваем в одну строку, раскрыть можно тапом; шестеренка остается в строке. Не применена
  // (в т. ч. план шаблона) — блок целиком: там кнопка «Применить рекомендацию».
  // 19.10.2026 (fb_420182ea, fb_cc29e75a): «правили» запоминается — вернул подходы ровно к
  // рекомендации, блок больше не разворачивается сам; раскрытый вручную сворачивается стрелкой
  // в его шапке. Отметка сбрасывается, когда рекомендация снята (откат / выключили).
  const [apOpen, setApOpen] = useState(false)
  const [apEdited, setApEdited] = useState(false)
  const live = entry.prog && !entry.prog.muted && entry.prog.applied ? entry.prog : null
  const diverged = Boolean(live) && !sameSets(entry.sets, live.recSets)
  if (diverged && !apEdited) setApEdited(true)
  if (!live && (apEdited || apOpen)) { setApEdited(false); setApOpen(false) }
  const apFoldable = Boolean(live) && apEdited
  const apCompact = apFoldable && !apOpen && !live.settingsOpen

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
          <Chevron className="exercise-compact-chevron" />
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
        <span className="exercise-title" tabIndex={0} aria-label={`${entry.exercise.name}. Изменить порядок: Alt и стрелки вверх или вниз`}>
          <TitleWithTechnique name={entry.exercise.name} onTechnique={onTechnique} />
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
          ) : apCompact ? (
            <div className="ap-muted-row">
              <button type="button" className="ap-compact" aria-expanded="false"
                aria-label={`Прошлая тренировка и рекомендация: ${daysAgoLabel(entry.prog.whenIso)}`}
                onClick={() => setApOpen(true)}>
                <span className="ap-lbl">Прошлая · {daysAgoLabel(entry.prog.whenIso)}</span>
                <span className="ap-prev"><SetsCells metric={metric} sets={entry.prog.prev} sep=" · " empty="" /></span>
                <Chevron toggle size={16} />
              </button>
              <button
                className="btn-gear"
                aria-label="Настройки прогрессии"
                aria-expanded={false}
                onClick={() => onToggleProgSettings(ei)}
              ><GearIcon /></button>
            </div>
          ) : (
            <>
              {apFoldable && !entry.prog.settingsOpen ? (
                <button type="button" className="ap-row ap-fold" aria-expanded="true"
                  aria-label="Свернуть прошлую тренировку и рекомендацию" onClick={() => setApOpen(false)}>
                  <span className="ap-lbl">Прошлая</span>
                  <span className="ap-when">{daysAgoLabel(entry.prog.whenIso)} <Chevron toggle open size={16} /></span>
                </button>
              ) : (
                <div className="ap-row">
                  <span className="ap-lbl">Прошлая</span>
                  <span className="ap-when">{daysAgoLabel(entry.prog.whenIso)}</span>
                </div>
              )}
              <div className="ap-prev">
                <SetsCells metric={metric} sets={entry.prog.prev} sep=" · " empty="" />
              </div>
              <div className={`ap-rec-lbl ${progTone(entry.prog.kind)}`}>
                {progArrow(entry.prog.kind)} Рекомендуем сегодня
              </div>
              <div className="ap-rec">
                <SetsCells metric={metric} sets={entry.prog.recSets} sep=" · " empty="" />
              </div>
              <span className={`reason ${progTone(entry.prog.kind)}`}>{entry.prog.reason}</span>
              <div className="ap-actions">
                {entry.prog.applied ? (
                  <button className="link-btn ap-revert" onClick={() => onRevertProg(ei)}>
                    {entry.fromTemplate ? 'вернуть план шаблона' : 'вернуть как в прошлый раз'}
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
                      <HoldButton aria-label="Шаг прогрессии меньше" onTrigger={() => onChangeProgSettings(ei, { step: nextProgStep(eff.step, metric, -1) })}>−</HoldButton>
                      <span className="ap-step-val">{fmtProgStep(eff.step, metric)}</span>
                      <HoldButton aria-label="Шаг прогрессии больше" onTrigger={() => onChangeProgSettings(ei, { step: nextProgStep(eff.step, metric, +1) })}>+</HoldButton>
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
          : <><span>#</span><span>{isDistance ? 'км' : extra ? '±кг' : 'кг'}</span><span>{isDistance ? 'мин:сек' : 'повт.'}</span><span></span></>}
      </div>

      {entry.sets.map((s, si) => (
        <div key={s._k ?? si} className="set-row">
          {/* Номер подхода — просто подпись (v6.1.0): отметок выполнения больше
              нет, колонка узкая, ширина уходит степперам. */}
          <span className="set-no" aria-hidden="true">{si + 1}</span>

          {!count && (
            <div className="stepper" role="group" aria-label={`Подход ${si + 1}, ${isDistance ? 'дистанция' : extra ? 'доп. вес или помощь' : 'вес'}`}>
              <HoldButton aria-label={isDistance ? 'Меньше дистанция' : 'Меньше вес'} onTrigger={() => onStep(ei, si, 'weight', isDistance ? -0.5 : extra ? -2.5 : -1.25)}>−</HoldButton>
              {/* Ноль доп. веса — пустое поле. Только ЧИСЛОВОЙ ноль: строку ввода
                  («-», «0.») показываем как есть, иначе минус и «0,5» не набрать. */}
              <SetInput
                inputMode="decimal" value={extra && s.weight === 0 ? '' : fmtNum(s.weight ?? '')}
                aria-label={`${isDistance ? 'Дистанция, км' : extra ? 'Доп. вес' : 'Вес'}, подход ${si + 1}`}
                placeholder={isDistance ? 'км' : extra ? '0' : undefined}
                onChange={(e) => onUpdateSet(ei, si, 'weight', e.target.value.replace(',', '.').replace('−', '-'))}
              />
              <HoldButton aria-label={isDistance ? 'Больше дистанция' : 'Больше вес'} onTrigger={() => onStep(ei, si, 'weight', isDistance ? 0.5 : extra ? 2.5 : 1.25)}>+</HoldButton>
            </div>
          )}

          {isTime ? (
            <div className="stepper" role="group" aria-label={`Подход ${si + 1}, время`}>
              <HoldButton aria-label="Меньше время" onTrigger={() => onStep(ei, si, 'reps', isDistance ? -30 : -5)}>−</HoldButton>
              <TimeInput
                value={s.reps}
                aria-label={`Время, подход ${si + 1}`}
                onChange={(sec) => onUpdateSet(ei, si, 'reps', sec)}
              />
              <HoldButton aria-label="Больше время" onTrigger={() => onStep(ei, si, 'reps', isDistance ? 30 : 5)}>+</HoldButton>
            </div>
          ) : (
            <div className="stepper" role="group" aria-label={`Подход ${si + 1}, повторения`}>
              <HoldButton aria-label="Меньше повторений" onTrigger={() => onStep(ei, si, 'reps', -1)}>−</HoldButton>
              <SetInput
                inputMode="numeric" pattern="[0-9]*" value={s.reps}
                aria-label={`Повторения, подход ${si + 1}`}
                onChange={(e) => onUpdateSet(ei, si, 'reps', e.target.value.replace(/\D/g, ''))}
              />
              <HoldButton aria-label="Больше повторений" onTrigger={() => onStep(ei, si, 'reps', 1)}>+</HoldButton>
            </div>
          )}

          <button className="set-rm" onClick={() => onRemoveSet(ei, si)} aria-label={`Удалить подход ${si + 1}`}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      ))}

      {isDistance && (
        <p className="set-pace muted" aria-live="polite">
          {pace ? `Темп: ${fmtPace(pace)}` : 'Укажи км и время — посчитаю темп'}
        </p>
      )}

      {/* Голос спрятан (lib/features.js), код живет. */}
      {VOICE_ENABLED && onVoiceSet && !isTime ? (
        <SetVoice exercise={entry.exercise} sets={entry.sets} cursor={voiceCursor}
          onCommit={(si, set) => onVoiceSet(ei, si, set)}>
          <AddSetButton short={Boolean(restSlot)} onClick={() => onAddSet(ei)} />
          {restSlot}
        </SetVoice>
      ) : restSlot ? (
        <div className="set-add-row">
          <AddSetButton short onClick={() => onAddSet(ei)} />
          {restSlot}
        </div>
      ) : <AddSetButton onClick={() => onAddSet(ei)} />}

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

// short — рядом с таймером отдыха места меньше: видно «+ подход», полное имя — для
// скринридера (видимый текст входит в имя, WCAG 2.5.3).
function AddSetButton({ onClick, short = false }) {
  return (
    <button className="set-add" onClick={onClick} aria-label={short ? '+ подход (повтор предыдущего)' : undefined}>
      {short ? '+ подход' : '+ подход (повтор предыдущего)'}
    </button>
  )
}

// Название + «i» сразу за последним словом: слово и значок не разрываются переносом.
// Поле подхода (вес/повторы): текстовое с цифровой клавиатурой — у type=number нет API
// выделения, и выделить значение на тапе там нельзя. Тап выделяет число целиком.
function SetInput(props) {
  const select = useSelectOnFocus()
  return <input type="text" autoComplete="off" {...props} {...select} />
}

function TitleWithTechnique({ name, onTechnique }) {
  if (!onTechnique) return <span className="exercise-name">{name}</span>
  const i = name.lastIndexOf(' ')
  const head = i > 0 ? name.slice(0, i + 1) : ''
  const last = i > 0 ? name.slice(i + 1) : name
  return (
    <span className="exercise-name">
      {head}
      <span className="exercise-name-tail">{last}<TechniqueButton name={name} onClick={onTechnique} className="tb-after" /></span>
    </span>
  )
}

// Подходы совпадают с предложенными (рекомендация или прошлая) — значит, их еще не правили.
function sameSets(a = [], b = []) {
  return a.length === b.length && a.every((s, i) => String(s.weight ?? '') === String(b[i]?.weight ?? '') && String(s.reps ?? '') === String(b[i]?.reps ?? ''))
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

// Темп короткого отрезка (меньше 1 км), когда длинных нет: подсказка при вводе,
// а не рекорд — рекордный темп считается только от 1 км (lib/metric.js bestPace).
function lastPace(sets) {
  for (let i = (sets ?? []).length - 1; i >= 0; i--) {
    const p = paceSecPerKm(sets[i]?.weight, sets[i]?.reps)
    if (p != null) return p
  }
  return null
}
