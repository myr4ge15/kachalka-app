import { sk } from '../../lib/progressionCard.js'
import HoldButton from '../ui/HoldButton.jsx'
import { fmtNum } from '../../lib/metric.js'
import TimeInput from '../ui/TimeInput.jsx'
import { useSelectOnFocus } from '../../hooks/useSelectOnFocus.js'
import './TemplateSets.css'

// Подходы шаблона — как карточка упражнения в тренировке (16.10, обращение fb_58cbb46a):
// строка «№ − вес + − повторы + ✕», под ними «+ подход». Те же классы (.sets-head, .set-row,
// .stepper, .set-rm, .set-add), что у ExerciseCard. Перестановки подходов ↑/↓ больше нет:
// три кнопки под каждым подходом и делали карточку громоздкой; порядок — порядок добавления.
// Управляемый редактор: каждое изменение возвращает новый список подходов.
const STEP = { weight: { weight: 1.25, reps: 1 }, reps: { weight: 2.5, reps: 1 }, time: { reps: 5 }, distance: { weight: 0.5, reps: 30 } }
const MIN = { weight: { weight: 0, reps: 1 }, reps: { weight: -200, reps: 1 }, time: { reps: 1 }, distance: { weight: 0, reps: 1 } }

export default function TemplateSets({ metric, sets, onChange }) {
  const m = STEP[metric] ? metric : 'weight'
  const isTime = m === 'time' || m === 'distance'
  const hasWeight = m !== 'time'
  function update(index, field, value) {
    onChange(sets.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }
  function bump(index, field, dir) {
    const cur = Number(String(sets[index][field] ?? '').replace(',', '.')) || 0
    const next = Math.max(MIN[m][field], Math.round((cur + dir * STEP[m][field]) * 100) / 100)
    update(index, field, next)
  }
  const weightLab = m === 'distance' ? 'км' : m === 'reps' ? '±кг' : 'кг'
  return <div className="template-sets">
    <div className="sets-head">
      {hasWeight
        ? <><span>#</span><span>{weightLab}</span><span>{isTime ? 'мин:сек' : 'повт.'}</span><span></span></>
        : <><span>#</span><span>мин:сек</span><span></span></>}
    </div>
    {sets.map((s, i) => <div className="set-row" key={s._k} role="group" aria-label={`Подход ${i + 1}`}>
      <span className="set-no" aria-hidden="true">{i + 1}</span>
      {hasWeight && <div className="stepper">
        <HoldButton aria-label={`Меньше, подход ${i + 1}`} onTrigger={() => bump(i, 'weight', -1)}>−</HoldButton>
        <SetInput inputMode="decimal" aria-label={`Вес или дистанция подхода ${i + 1}`}
          value={fmtNum(s.weight ?? '')} onChange={(e) => update(i, 'weight', e.target.value.replace(',', '.').replace('−', '-'))} />
        <HoldButton aria-label={`Больше, подход ${i + 1}`} onTrigger={() => bump(i, 'weight', 1)}>+</HoldButton>
      </div>}
      <div className="stepper">
        <HoldButton aria-label={`Меньше ${isTime ? 'время' : 'повторов'}, подход ${i + 1}`} onTrigger={() => bump(i, 'reps', -1)}>−</HoldButton>
        {isTime
          ? <TimeInput value={s.reps} aria-label={`Время подхода ${i + 1}`} onChange={(v) => update(i, 'reps', v)} />
          : <SetInput inputMode="numeric" pattern="[0-9]*" aria-label={`Повторы подхода ${i + 1}`}
            value={s.reps} onChange={(e) => update(i, 'reps', e.target.value.replace(/\D/g, ''))} />}
        <HoldButton aria-label={`Больше ${isTime ? 'время' : 'повторов'}, подход ${i + 1}`} onTrigger={() => bump(i, 'reps', 1)}>+</HoldButton>
      </div>
      <button type="button" className="set-rm" disabled={sets.length === 1} aria-label={`Удалить подход ${i + 1}`}
        onClick={() => onChange(sets.filter((_, j) => i !== j))}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>)}
    <button type="button" className="set-add" disabled={sets.length >= 1000}
      onClick={() => onChange([...sets, { ...sets.at(-1), _k: sk() }])}>+ подход (повтор предыдущего)</button>
  </div>
}

// Поле подхода: текст с цифровой клавиатурой, тап выделяет число целиком (как в тренировке).
function SetInput(props) {
  const select = useSelectOnFocus()
  return <input type="text" autoComplete="off" {...props} {...select} />
}
