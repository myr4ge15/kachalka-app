import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getExercises } from '../../db/repo.js'
import { invalidateRatingCache } from '../../db/disciplines.js'
import { fmtDate } from '../../lib/dates.js'

// Владельцу: название, автоприем, живые коды участников (отозвать), дисциплины рейтинга
// круга, удалить круг. Права — только внутри своего круга (это не Админка).
export default function CircleOwnerSettings({ api, circle, onChanged, onDeleted }) {
  const [name, setName] = useState(circle.name)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [codes, setCodes] = useState(null)
  const [armDelete, setArmDelete] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { setName(circle.name) }, [circle.name])

  const loadCodes = useCallback(async () => {
    try { const c = await api.codes(circle.circle_id); if (alive.current) setCodes(c) } catch (e) { if (alive.current) setErr(e.message) }
  }, [api, circle.circle_id])
  useEffect(() => { loadCodes() }, [loadCodes])

  async function act(key, fn, after) {
    setBusy(key); setErr('')
    try {
      await fn()
      if (!alive.current) return
      await after?.()
      onChanged?.()
    } catch (e) {
      if (alive.current) setErr(e.message)
    } finally {
      if (alive.current) setBusy('')
    }
  }

  const nameDirty = name.trim() !== circle.name
  return (
    <div className="card fc-owner">
      <h3 className="fc-h">Настройки круга</h3>
      <div className="field">
        <label className="field-lab" htmlFor="fc-name">Название</label>
        <div className="fc-join-row">
          <input id="fc-name" className="admin-input" maxLength={40} value={name} disabled={!!busy}
            onChange={(e) => setName(e.target.value)} />
          {nameDirty && <button type="button" className="btn ghost" disabled={!!busy || !name.trim()}
            onClick={() => act('name', () => api.rename(circle.circle_id, name))}>Сохранить</button>}
        </div>
      </div>
      <label className="fc-toggle">
        <input type="checkbox" checked={circle.auto_approve} disabled={!!busy}
          onChange={(e) => act('auto', () => api.setAutoApprove(circle.circle_id, e.target.checked))} />
        <span>Принимать по коду сразу<span className="muted fc-sub-inline">{circle.auto_approve ? '' : ' — сейчас каждую заявку решаешь ты'}</span></span>
      </label>

      <p className="fc-sub">Живые коды участников</p>
      {codes === null ? <p className="muted">…</p> : codes.length === 0 ? <p className="muted">Сейчас ни у кого нет живого кода.</p> : (
        <ul className="fc-list">
          {codes.map((c) => (
            <li key={c.code_id} className="fc-row">
              <span className="fc-who"><span className="fc-name">{c.holder_name}</span>
                <span className="muted fc-by">вступили {c.uses} из {c.max_uses} · до {fmtDate(c.expires_at)}</span></span>
              <button type="button" className="link-btn danger" disabled={!!busy}
                onClick={() => act(`rv-${c.code_id}`, () => api.revokeCode(c.code_id), loadCodes)}>Отозвать</button>
            </li>
          ))}
        </ul>
      )}

      <CircleDisciplines api={api} circle={circle} />

      <div className="fc-danger">
        {armDelete ? (
          <>
            <p className="danger-text">Удалить круг «{circle.name}»? Участники перестанут видеть друг друга (если их не связывает что-то еще), коды сгорят. Тренировки у всех останутся.</p>
            <div className="danger-actions">
              <button type="button" className="btn ghost" onClick={() => setArmDelete(false)} disabled={!!busy}>Отмена</button>
              <button type="button" className="btn danger" disabled={!!busy}
                onClick={() => act('del', () => api.remove_circle(circle.circle_id), onDeleted)}>Удалить круг</button>
            </div>
          </>
        ) : (
          <button type="button" className="act danger" onClick={() => setArmDelete(true)}>Удалить круг</button>
        )}
      </div>
      {err && <p className="pin-err" role="alert">{err}</p>}
    </div>
  )
}

// Дисциплины рейтинга круга: включить/выключить, «делить по полу», добавить из общего
// каталога (не личные, не скрытые, не дистанция).
function CircleDisciplines({ api, circle }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState('')
  const exercises = useLiveQuery(() => getExercises(), [], [])
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const load = useCallback(async () => {
    try { const d = await api.disciplines(circle.circle_id); if (alive.current) setItems(d) } catch (e) { if (alive.current) setErr(e.message) }
  }, [api, circle.circle_id])
  useEffect(() => { load() }, [load])

  const candidates = useMemo(() => {
    const taken = new Set((items ?? []).map((d) => d.exercise_id))
    return (exercises ?? []).filter((e) => !e.is_custom && e.metric !== 'distance' && !taken.has(e.id))
  }, [exercises, items])

  async function save(exerciseId, split, enabled) {
    setBusy(true); setErr('')
    try {
      await api.saveDiscipline(circle.circle_id, exerciseId, split, enabled)
      await invalidateRatingCache()
      await load()
      if (alive.current) setAdding('')
    } catch (e) {
      if (alive.current) setErr(e.message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <div className="fc-disc">
      <p className="fc-sub">Дисциплины рейтинга круга</p>
      {items === null ? <p className="muted">…</p> : (
        <ul className="fc-list">
          {items.map((d) => (
            <li key={d.id} className="fc-row">
              <label className="fc-toggle fc-grow">
                <input type="checkbox" checked={d.enabled} disabled={busy}
                  onChange={(e) => save(d.exercise_id, d.split_by_sex, e.target.checked)} />
                <span>{d.name}</span>
              </label>
              <label className="fc-toggle fc-small">
                <input type="checkbox" checked={d.split_by_sex} disabled={busy || !d.enabled}
                  onChange={(e) => save(d.exercise_id, e.target.checked, d.enabled)} />
                <span>по полу</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="fc-join-row">
        <select className="admin-input" aria-label="Добавить дисциплину" value={adding} disabled={busy}
          onChange={(e) => setAdding(e.target.value)}>
          <option value="">Добавить упражнение…</option>
          {candidates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button type="button" className="btn ghost" disabled={busy || !adding} onClick={() => save(adding, true, true)}>Добавить</button>
      </div>
      {err && <p className="pin-err" role="alert">{err}</p>}
    </div>
  )
}
