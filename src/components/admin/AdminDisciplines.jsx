import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getRatingCatalog, fetchRatingCatalog } from '../../db/disciplines.js'
import { adminSaveDiscipline } from '../../lib/adminDisciplines.js'
import { DISCIPLINE_UNITS } from '../../lib/disciplines.js'
import CheckIcon from '../ui/CheckIcon.jsx'

export default function AdminDisciplines({ userId, exercises, online }) {
  const catalog = useLiveQuery(getRatingCatalog, [], null)
  const items = catalog?.items ?? []
  const [exercise, setExercise] = useState('')
  const [split, setSplit] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  // Дистанция в рейтинге пока не поддерживается (v6.12.0): сервер считает результат по повторам/весу.
  const available = exercises.filter(e => !e.is_hidden && e.metric !== 'distance' && !items.some(d => d.exercise_id === e.id))
  useEffect(() => {
    let active = true
    if (online) fetchRatingCatalog(userId, { force: true }).catch(() => {
      if (active) setError('Не удалось загрузить дисциплины. Проверь соединение и наличие обновления сервера.')
    })
    return () => { active = false }
  }, [userId, online])

  async function save(value) {
    if (busy || !online) return
    setBusy(true); setError('')
    try {
      const result = await adminSaveDiscipline(userId, value)
      if (alive.current) {
        setExercise('')
        if (result?.refreshed === false) setError('Сохранено, но список не обновился. Нажми «Обновить список».')
      }
    } catch (err) { if (alive.current) setError(err.message || 'Не удалось сохранить') }
    finally { if (alive.current) setBusy(false) }
  }
  async function refresh() {
    setBusy(true); setError('')
    try { await fetchRatingCatalog(userId, { force: true }) }
    catch { if (alive.current) setError('Не удалось обновить список.') }
    finally { if (alive.current) setBusy(false) }
  }
  const off = busy || !online
  // Компактный список (v1.4.4 э2): строка «название · единица · по полу · ✕» в одной карточке
  // через разделитель, вместо отдельной крупной карточки с кнопкой на всю ширину.
  return <section className="admin-disciplines" aria-label="Дисциплины рейтинга">
    <div className="disc-head">
      <p className="muted">Результаты берем из всей истории тренировок.</p>
      <button type="button" className="btn ghost btn--sm" disabled={off} onClick={refresh}>Обновить список</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {catalog && !items.length && <p className="muted">Дисциплин пока нет.</p>}
    {items.length > 0 && <ul className="disc-list">
      {items.map(d => <li key={d.id} className="disc-row">
        <span className="disc-name">{d.name}<span className="disc-unit">{DISCIPLINE_UNITS[d.metric]}</span></span>
        <SexChip checked={d.split_by_sex} disabled={off} onChange={v => save({ ...d, split_by_sex: v })} />
        <button type="button" className="disc-rm" disabled={off} onClick={() => save({ ...d, enabled: false })}
          aria-label={`Убрать из рейтинга: ${d.name}`} title="Убрать из рейтинга">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </li>)}
    </ul>}
    <form className="disc-add" onSubmit={e => { e.preventDefault(); save({ exercise_id: exercise, split_by_sex: split }) }}>
      <select className="admin-input" aria-label="Упражнение" value={exercise} onChange={e => setExercise(e.target.value)}
        disabled={off || !catalog} required>
        <option value="">Добавить упражнение…</option>
        {available.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
      <div className="disc-add-row">
        <SexChip checked={split} disabled={off} onChange={setSplit} />
        <button className="btn primary btn--sm" aria-label="Добавить дисциплину"
          disabled={!exercise || off || !catalog}>{busy ? 'Сохраняю…' : 'Добавить'}</button>
      </div>
    </form>
    <p className="muted disc-note">«По полу» — отдельные таблицы для мужчин и женщин, без пола — своя группа. Убрать дисциплину не значит удалить тренировки.</p>
  </section>
}

// Переключатель «раздельно по полу» чипом: настоящий чекбокс (скрыт визуально), подпись — коротко.
function SexChip({ checked, disabled, onChange }) {
  return <label className={'disc-sex' + (checked ? ' on' : '') + (disabled ? ' off' : '')}>
    <input type="checkbox" className="sr-only" aria-label="Раздельно по полу" checked={checked} disabled={disabled}
      onChange={e => onChange(e.target.checked)} />
    {checked && <CheckIcon size={14} />}по полу
  </label>
}
