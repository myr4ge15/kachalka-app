import { sk } from '../../lib/progressionCard.js'
import HoldButton from '../ui/HoldButton.jsx'
import { setStep, steppedSetValue } from '../../lib/setLimits.js'
import { fmtNum, hasWeightField, normMetric } from '../../lib/metric.js'
import TimeInput from '../ui/TimeInput.jsx'
import { useSelectOnFocus } from '../../hooks/useSelectOnFocus.js'
import './TemplateSets.css'
import Icon from '../ui/Icon.jsx'

// Подходы шаблона — как карточка упражнения в тренировке (16.10, обращение fb_58cbb46a):
// строка «№ − вес + − повторы + ✕», под ними «+ подход». Те же классы (.sets-head, .set-row,
// .stepper, .set-rm, .set-add), что у ExerciseCard. Перестановки подходов ↑/↓ больше нет:
// три кнопки под каждым подходом и делали карточку громоздкой; порядок — порядок добавления.
// Управляемый редактор: каждое изменение возвращает новый список подходов.
export default function TemplateSets({ metric, sets, onChange }) {
  const m = normMetric(metric)
  const isTime = m === 'time' || m === 'distance'
  const hasWeight = hasWeightField(m)
  function update(index, field, value) {
    onChange(sets.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }
  function bump(index, field, dir) {
    const delta = dir * setStep(m, field)
    update(index, field, steppedSetValue(sets[index][field], m, field, delta))
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
        <SetInput inputMode={m === 'reps' ? 'text' : 'decimal'} aria-label={`Вес или дистанция подхода ${i + 1}`}
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
        <Icon name="close" size={15} strokeWidth={2.4} />
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
