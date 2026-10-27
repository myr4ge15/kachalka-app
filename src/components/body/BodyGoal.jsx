import { useState } from 'react'
import HoldButton from '../ui/HoldButton.jsx'
import { showToast } from '../ui/Toast.jsx'
import { localYmd } from '../../lib/calendar.js'
import {
  WEIGHT_MIN, WEIGHT_MAX, parseWeight, goalLeft, goalForecast, fmtBodyDate,
} from '../../lib/body.js'
import { setBodyPrefs } from '../../db/body.js'

// Цель по весу — необязательная карточка (правило 6: «держать» — полноценная цель).
// Свое состояние редактора. Пропсы: userId, goal|null, current — вес по тренду (null —
// записей нет), pace — кг/нед или null, hide — «Скрыть цифры».
// Тексты — только про движение к своей цели: «до цели», «≈ к 15 декабря». Если тренд идет
// не туда — прогноза нет и ничего не говорим (правило 5).
const KINDS = [
  { id: 'down', label: 'Сбросить', title: 'Сбросить до' },
  { id: 'up', label: 'Набрать', title: 'Набрать до' },
  { id: 'keep', label: 'Держать', title: 'Держать' },
]

export default function BodyGoal({ userId, goal, current, pace, hide = false }) {
  const [edit, setEdit] = useState(false)
  const [kind, setKind] = useState(goal?.kind ?? 'down')
  const [target, setTarget] = useState('')

  function open() {
    setKind(goal?.kind ?? 'down')
    setTarget(hide && !goal ? '' : String(goal?.target ?? (current != null ? Math.round(current) : '')))
    setEdit(true)
  }

  const t = parseWeight(target)
  const bump = (d) => setTarget((v) => {
    const n = parseWeight(v)
    return n == null ? v : String(Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, Math.round((n + d) * 10) / 10)))
  })

  async function save(next) {
    try {
      await setBodyPrefs(userId, { goal: next })
      setEdit(false)
    } catch (e) {
      showToast({ icon: 'alert', title: 'Не удалось сохранить цель', sub: String(e?.message ?? e) })
    }
  }

  if (edit) {
    return (
      <section className="sec">
        <p className="sec-title">Цель</p>
        <div className="card body-goal">
          <div className="seg" role="radiogroup" aria-label="Какая цель">
            {KINDS.map((k) => (
              <button key={k.id} type="button" role="radio" aria-checked={kind === k.id}
                className={`seg-item${kind === k.id ? ' on' : ''}`} onClick={() => setKind(k.id)}>{k.label}</button>
            ))}
          </div>
          <div className="body-field">
            <span className="body-field-lbl" id="body-goal-lbl">{kind === 'keep' ? 'Вес, кг (коридор ±1.5)' : 'Целевой вес, кг'}</span>
            <div className="stepper body-stepper">
              <HoldButton aria-label="Цель меньше на 0.5" disabled={t == null} onTrigger={() => bump(-0.5)}>−</HoldButton>
              <input aria-labelledby="body-goal-lbl" inputMode="decimal" value={target} placeholder="кг"
                onChange={(e) => setTarget(e.target.value)} />
              <HoldButton aria-label="Цель больше на 0.5" disabled={t == null} onTrigger={() => bump(0.5)}>+</HoldButton>
            </div>
          </div>
          <div className="btn-row">
            <button type="button" className="btn ghost" onClick={() => setEdit(false)}>Отмена</button>
            <button type="button" className="btn primary" disabled={t == null}
              onClick={() => save({ kind, target: t, from: current ?? null, set: localYmd(new Date()) })}>Сохранить</button>
          </div>
        </div>
      </section>
    )
  }

  if (!goal) {
    return (
      <section className="sec">
        <p className="sec-title">Цель · по желанию</p>
        <button type="button" className="add-btn" onClick={open}>Поставить цель</button>
      </section>
    )
  }

  const meta = KINDS.find((k) => k.id === goal.kind)
  const left = goalLeft(goal, current)
  const when = goalForecast(goal, current, pace)
  const reached = left?.reached
  let sub = null
  if (!hide && left) {
    if (goal.kind === 'keep') sub = reached ? 'держишь' : null
    else if (reached) sub = 'цель достигнута'
    else sub = `${left.left} кг до цели${when ? ` · ≈ к ${fmtBodyDate(when)}` : ''}`
  } else if (hide && reached) {
    sub = goal.kind === 'keep' ? 'держишь' : 'цель достигнута'
  } else if (hide && when) {
    sub = `идешь к цели · ≈ к ${fmtBodyDate(when)}`
  }

  return (
    <section className="sec">
      <p className="sec-title">Цель</p>
      <div className="card body-goal">
        <div className="body-goal-head">
          <div>
            <div className="body-goal-title">{meta.title}{hide ? '' : ` ${goal.target} кг`}</div>
            {sub && <div className={`body-goal-sub${reached ? ' body-good' : ''}`}>{sub}</div>}
          </div>
        </div>
        <div className="btn-row">
          <button type="button" className="btn ghost btn--sm" onClick={() => save(null)}>Снять цель</button>
          <button type="button" className="btn ghost btn--sm" onClick={open}>Изменить</button>
        </div>
      </div>
    </section>
  )
}
