import { sk } from '../lib/progressionCard.js'
import TimeInput from './TimeInput.jsx'
import './TemplateSets.css'

// Управляемый редактор: каждое изменение возвращает новый список подходов.
export default function TemplateSets({ metric, sets, onChange }) {
  const timed = metric === 'time' || metric === 'distance'
  function update(index, field, value) {
    onChange(sets.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }
  function move(index, delta) {
    const next = [...sets]
    ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
    onChange(next)
  }
  return <div className="template-sets">
    {sets.map((s, i) => <div className="template-set" key={s._k} role="group" aria-label={`Подход ${i + 1}`}>
      <span className="muted">{i + 1}</span>
      {metric !== 'time' && <label className="tpl-target">
        <span className="tpl-target-lab">{metric === 'distance' ? 'км' : metric === 'reps' ? '±кг' : 'кг'}</span>
        <input type="text" inputMode="decimal" aria-label={`Вес или дистанция подхода ${i + 1}`}
          value={s.weight} onChange={(e) => update(i, 'weight', e.target.value.replace(',', '.'))} />
      </label>}
      <label className="tpl-target">
        <span className="tpl-target-lab">{timed ? 'мин:сек' : 'повт.'}</span>
        {timed ? <TimeInput value={s.reps} aria-label={`Время подхода ${i + 1}`} onChange={(v) => update(i, 'reps', v)} />
          : <input type="number" inputMode="numeric" min="1" aria-label={`Повторы подхода ${i + 1}`}
            value={s.reps} onChange={(e) => update(i, 'reps', e.target.value)} />}
      </label>
      <div className="template-set-actions">
        <button type="button" className="btn ghost" disabled={i === 0} aria-label={`Подход ${i + 1} выше`} onClick={() => move(i, -1)}>↑</button>
        <button type="button" className="btn ghost" disabled={i === sets.length - 1} aria-label={`Подход ${i + 1} ниже`} onClick={() => move(i, 1)}>↓</button>
        <button type="button" className="btn ghost" disabled={sets.length === 1} aria-label={`Удалить подход ${i + 1}`} onClick={() => onChange(sets.filter((_, j) => i !== j))}>×</button>
      </div>
    </div>)}
    <button type="button" className="btn outline full" disabled={sets.length >= 1000}
      onClick={() => onChange([...sets, { ...sets.at(-1), _k: sk() }])}>+ Добавить подход</button>
  </div>
}
