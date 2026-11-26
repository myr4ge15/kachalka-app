import { useState } from 'react'
import SheetDialog from '../ui/SheetDialog.jsx'
import CheckIcon from '../ui/CheckIcon.jsx'
import ExercisePicker from '../exercises/ExercisePicker.jsx'
import { parseWorkoutPlan } from '../../lib/planImport/parser.js'
import { checkLastWorkout } from '../../lib/planImport/catalog.js'
import { IS_BETA } from '../../lib/appVersion.js'
import { acceptsTargets, describeTarget, matchExercise } from '../../lib/planImport/draft.js'

export default function PlanImport({ catalog, workouts, replacing, onSave, onClose }) {
  const [source, setSource] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [choices, setChoices] = useState({})
  const [picking, setPicking] = useState(null)
  function preview() {
    try {
      const parsed = parseWorkoutPlan(source)
      if (IS_BETA) checkLastWorkout(parsed, source, workouts ?? [], 'в журнале на устройстве')
      setResult(parsed)
      setChoices({})
      setError('')
    } catch (err) {
      setError(err instanceof SyntaxError ? 'Ошибка в JSON. Проверь скобки и кавычки.' : err.message)
    }
  }
  const items = result?.plan.exercises ?? []
  const ids = items.map((item, i) => choices[i] ?? matchExercise(item, catalog))
  const chosen = ids.filter(id => id && id !== 'skip')
  const duplicate = chosen.length !== new Set(chosen).size
  const unresolved = ids.filter(id => !id).length
  const ready = chosen.length > 0 && !duplicate && ids.every(id => id === 'skip' || catalog.some(ex => ex.id === id))
  function choose(i, id) {
    setChoices(previous => ({ ...previous, [i]: id }))
    setPicking(null)
  }
  function save() {
    if (!ready) return
    const exercises = items.flatMap((item, i) => ids[i] === 'skip' ? [] : [{ ...catalog.find(ex => ex.id === ids[i]), planTarget: item }])
    onSave(exercises, { name: result.plan.name, date: result.plan.date, notes: result.plan.notes,
      ...(IS_BETA && { context: [...result.review.map(r => r.reason + ' — ' + r.text), ...result.notes.map(n => n.text)].join('\n') }) })
  }
  return <>
    <SheetDialog title="Вставить план" className="sheet--compact" onDismiss={onClose} swipeBack swipeDown>
      <div className="sheet-scroll plan-import">
        {!result ? <label>Текст тренировки или JSON
          <textarea className="admin-input" rows={5} placeholder="Например, Жим лежа: 3×8 (60 кг)" maxLength={200000} value={source} onChange={e => { setSource(e.target.value); setError('') }} />
        </label> : <>
          <p>{[result.plan.name, result.plan.date, 'Упражнений: ' + items.length].filter(Boolean).join(' · ')}</p>
          {result.plan.notes && <p>{result.plan.notes}</p>}
          {IS_BETA && result.review.length > 0 && <details><summary>Проверить строки · {result.review.length}</summary>
            {result.review.map((r, i) => <p key={i}><strong>{r.reason}</strong><br />{r.text}</p>)}
          </details>}
          {IS_BETA && result.notes.length > 0 && <details><summary>Контекст ответа</summary>{result.notes.map(n => <p key={n.line}>{n.text}</p>)}</details>}
          {unresolved > 0 && <p role="status">Осталось выбрать или пропустить: {unresolved}</p>}
          {items.map((item, i) => {
            const ex = catalog.find(e => e.id === ids[i])
            return <section className="plan-import-item" key={i}>
              <strong>{ex && <CheckIcon />} {ex?.name ?? item.name}</strong>
              <p>{item.sets.map(describeTarget).join(' / ')}</p>
              {item.rest_sec && <p>Отдых · {[item.rest_sec].flat().join('–')} с</p>}
              {item.notes && <p className="plan-note">{item.notes}</p>}
              <div className="btn-row">
                <button type="button" className="btn ghost btn--sm" aria-label={ex ? 'Заменить «' + ex.name + '»' : undefined} onClick={() => setPicking(i)}>{ex ? 'Заменить' : ids[i] === 'skip' ? 'Пропущено · выбрать' : 'Выбрать упражнение'}</button>
                {ids[i] !== 'skip' && <button className="btn ghost btn--sm" onClick={() => choose(i, 'skip')}>Пропустить</button>}
              </div>
            </section>
          })}
          {duplicate && <p role="alert">Одно упражнение выбрано дважды. Измени выбор или пропусти повтор.</p>}
        </>}
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="btn-row">{result ? <>
        <button className="btn ghost" onClick={() => setResult(null)}>К тексту</button>
        <button className="btn primary" disabled={!ready} onClick={save}>{replacing ? 'Заменить текущий план' : 'Сохранить план'}</button>
      </> : <button className="btn primary" disabled={!source.trim()} onClick={preview}>Разобрать план</button>}</div>
    </SheetDialog>
    {picking !== null && <ExercisePicker exercises={catalog.filter(ex => acceptsTargets(ex, items[picking]))}
      title={'Выбрать для «' + items[picking].name + '»'} onClose={() => setPicking(null)} onPick={ex => choose(picking, ex.id)} />}
  </>
}
