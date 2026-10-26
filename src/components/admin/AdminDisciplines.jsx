import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getRatingCatalog, fetchRatingCatalog } from '../../db/disciplines.js'
import { adminSaveDiscipline } from '../../lib/adminDisciplines.js'
import { DISCIPLINE_UNITS } from '../../lib/disciplines.js'
import CheckIcon from '../ui/CheckIcon.jsx'
import Icon from '../ui/Icon.jsx'

export default function AdminDisciplines({ userId, exercises, online }) {
  const catalog = useLiveQuery(getRatingCatalog, [], null)
  // Оптимистично (fb_c6b5ce77): «по полу» и ✕ видны сразу, до ответа сервера; ошибка — откат. После успеха
  // черновик остается поверх каталога (совпадает с ним) — снять его в finally значило на кадр показать старый
  // снимок, пока useLiveQuery не принес свежий: чип мигал назад. Снимают его ошибка, «Обновить список» и
  // следующее сохранение.
  const [draft, setDraft] = useState(null) // { exercise_id, split_by_sex?, enabled? }
  const items = (catalog?.items ?? [])
    .map(d => (draft && d.exercise_id === draft.exercise_id ? { ...d, ...draft } : d))
    .filter(d => d.enabled !== false)
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
    if (value.id) setDraft({ exercise_id: value.exercise_id, split_by_sex: value.split_by_sex, enabled: value.enabled })
    try {
      const result = await adminSaveDiscipline(userId, value)
      if (alive.current) {
        setExercise('')
        if (result?.refreshed === false) setError('Сохранено, но список не обновился. Нажми «Обновить список».')
      }
    } catch (err) { if (alive.current) { setError(err.message || 'Не удалось сохранить'); setDraft(null) } }
    finally { if (alive.current) setBusy(false) }
  }
  async function refresh() {
    setBusy(true); setError(''); setDraft(null)
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
        <SexChip checked={d.split_by_sex} disabled={off} dim={!online} onChange={v => save({ ...d, split_by_sex: v })} />
        <button type="button" className={'disc-rm' + (online ? '' : ' off')} disabled={off} onClick={() => save({ ...d, enabled: false })}
          aria-label={`Убрать из рейтинга: ${d.name}`} title="Убрать из рейтинга">
          <Icon name="close" size={15} strokeWidth={2.4} />
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
        <SexChip checked={split} disabled={off} dim={!online} onChange={setSplit} />
        <button className="btn primary btn--sm" aria-label="Добавить дисциплину"
          disabled={!exercise || off || !catalog}>{busy && exercise && !draft ? 'Сохраняю…' : 'Добавить'}</button>
      </div>
    </form>
    <p className="muted disc-note">«По полу» — отдельные таблицы для мужчин и женщин, без пола — своя группа. Убрать дисциплину не значит удалить тренировки.</p>
  </section>
}

// Переключатель «раздельно по полу» чипом: настоящий чекбокс (скрыт визуально), подпись — коротко.
// dim — бледный только офлайн: пока идет сохранение, список не тускнеет (fb_c6b5ce77).
function SexChip({ checked, disabled, dim, onChange }) {
  return <label className={'disc-sex' + (checked ? ' on' : '') + (dim ? ' off' : '')}>
    <input type="checkbox" className="sr-only" aria-label="Раздельно по полу" checked={checked} disabled={disabled}
      onChange={e => onChange(e.target.checked)} />
    {/* Галочка всегда в разметке (скрыта без отметки): ширина чипа не меняется и строка не дергается (fb_c6b5ce77). */}
    <CheckIcon size={14} className="disc-sex-ico" />по полу
  </label>
}
