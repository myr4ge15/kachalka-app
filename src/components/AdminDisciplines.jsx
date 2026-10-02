import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getRatingCatalog, fetchRatingCatalog } from '../db/disciplines.js'
import { adminSaveDiscipline } from '../lib/adminDisciplines.js'
import { DISCIPLINE_UNITS } from '../lib/disciplines.js'

export default function AdminDisciplines({ userId, exercises, online }) {
  const catalog = useLiveQuery(getRatingCatalog, [], null)
  const items = catalog?.items ?? []
  const [exercise, setExercise] = useState('')
  const [split, setSplit] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const available = exercises.filter(e => !e.is_hidden && !items.some(d => d.exercise_id === e.id))
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
  return <section className="admin-disciplines" aria-label="Дисциплины рейтинга">
    <p className="muted">Выбери упражнения для рейтинга. Результаты берём из всей истории тренировок.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <button type="button" className="btn ghost" disabled={busy || !online} onClick={async () => {
      setBusy(true); setError('')
      try { await fetchRatingCatalog(userId, { force: true }) }
      catch { if (alive.current) setError('Не удалось обновить список.') }
      finally { if (alive.current) setBusy(false) }
    }}>Обновить список</button>
    {catalog && !items.length && <p className="muted">Дисциплин пока нет.</p>}
    <ul className="discipline-admin-list">
      {items.map(d => <li key={d.id}>
        <div><strong>{d.name}</strong><span className="muted">{DISCIPLINE_UNITS[d.metric]}</span></div>
        <label className="discipline-check"><input type="checkbox" checked={d.split_by_sex} disabled={busy || !online}
          onChange={e => save({ ...d, split_by_sex: e.target.checked })} />Раздельно по полу</label>
        <button type="button" className="btn ghost" disabled={busy || !online} onClick={() => save({ ...d, enabled: false })}
          aria-label={`Убрать из рейтинга: ${d.name}`}>Убрать из рейтинга</button>
      </li>)}
    </ul>
    <form className="discipline-add" onSubmit={e => { e.preventDefault(); save({ exercise_id: exercise, split_by_sex: split }) }}>
      <label>Упражнение<select value={exercise} onChange={e => setExercise(e.target.value)} disabled={busy || !online || !catalog} required>
        <option value="">Выбери упражнение</option>
        {available.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select></label>
      <label className="discipline-check"><input type="checkbox" checked={split} disabled={busy || !online} onChange={e => setSplit(e.target.checked)} />Раздельно по полу</label>
      <button className="btn primary" disabled={!exercise || busy || !online || !catalog}>{busy ? 'Сохраняю…' : 'Добавить дисциплину'}</button>
    </form>
    <p className="muted">Без разделения сравниваем всех вместе. При разделении участники без указанного пола попадают в отдельную группу. Удаление дисциплины не удаляет тренировки.</p>
  </section>
}
