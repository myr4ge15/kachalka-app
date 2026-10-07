import { useCallback, useEffect, useRef, useState } from 'react'
import Avatar from '../Avatar.jsx'

// Участники круга: кто кого привел; владельцу — заявки (принять/отклонить), удалить
// участника, передать круг. Действия с последствиями — в два нажатия.
export default function CircleMembers({ api, circle, me, onChanged }) {
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [arm, setArm] = useState(null) // { kind: 'remove' | 'transfer', id }
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const isOwner = circle.is_owner

  const load = useCallback(async () => {
    try {
      const rows = await api.members(circle.circle_id)
      if (alive.current) { setList(rows); setErr('') }
    } catch (e) {
      if (alive.current) setErr(e.message)
    }
  }, [api, circle.circle_id])
  useEffect(() => { load() }, [load])

  async function act(key, fn) {
    setBusy(key); setErr('')
    try {
      await fn()
      if (!alive.current) return
      setArm(null)
      await load()
      onChanged?.()
    } catch (e) {
      if (alive.current) setErr(e.message)
    } finally {
      if (alive.current) setBusy('')
    }
  }

  const pending = (list ?? []).filter((m) => m.status === 'pending')
  const active = (list ?? []).filter((m) => m.status === 'active')
  const armed = (kind, id) => arm?.kind === kind && arm?.id === id

  return (
    <div className="card fc-members">
      <h3 className="fc-h">Участники{list ? ` · ${active.length}` : ''}</h3>
      {list === null && !err && <p className="muted" role="status">Загружаю…</p>}
      {isOwner && pending.length > 0 && (
        <div className="fc-pending">
          <p className="fc-sub">Хотят в круг</p>
          {pending.map((m) => (
            <div key={m.user_id} className="fc-row">
              <Avatar name={m.name} url={m.avatar_url} className="avatar-sm" />
              <span className="fc-who"><span className="fc-name">{m.name}</span>
                {m.invited_by_name && <span className="muted fc-by">по коду {m.invited_by_name}</span>}</span>
              <span className="fc-row-acts">
                <button type="button" className="btn primary fc-mini" disabled={!!busy}
                  onClick={() => act(`ok-${m.user_id}`, () => api.decide(circle.circle_id, m.user_id, true))}>Принять</button>
                <button type="button" className="btn ghost fc-mini" disabled={!!busy}
                  onClick={() => act(`no-${m.user_id}`, () => api.decide(circle.circle_id, m.user_id, false))}>Нет</button>
              </span>
            </div>
          ))}
        </div>
      )}
      <ul className="fc-list">
        {active.map((m) => (
          <li key={m.user_id} className="fc-row">
            <Avatar name={m.name} url={m.avatar_url} className="avatar-sm" />
            <span className="fc-who">
              <span className="fc-name">{m.name}{m.user_id === me && <span className="feed-me">я</span>}{m.is_owner && <span className="fc-badge">владелец</span>}</span>
              {m.invited_by_name && !m.is_owner && <span className="muted fc-by">пришел(а) по коду {m.invited_by_name}</span>}
            </span>
            {isOwner && !m.is_owner && (
              <span className="fc-row-acts fc-under">
                <button type="button" className={armed('transfer', m.user_id) ? 'link-btn' : 'link-btn muted'} disabled={!!busy}
                  onClick={() => (armed('transfer', m.user_id)
                    ? act(`tr-${m.user_id}`, () => api.transfer(circle.circle_id, m.user_id).then((r) => {
                      if (r === 'has_own') throw new Error(`У ${m.name} уже есть свой круг — передать нельзя.`)
                    }))
                    : setArm({ kind: 'transfer', id: m.user_id }))}>
                  {armed('transfer', m.user_id) ? 'Точно передать?' : 'Передать круг'}
                </button>
                <button type="button" className={armed('remove', m.user_id) ? 'link-btn danger' : 'link-btn muted'} disabled={!!busy}
                  onClick={() => (armed('remove', m.user_id)
                    ? act(`rm-${m.user_id}`, () => api.remove(circle.circle_id, m.user_id))
                    : setArm({ kind: 'remove', id: m.user_id }))}>
                  {armed('remove', m.user_id) ? 'Точно убрать?' : 'Убрать'}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {err && <p className="pin-err" role="alert">{err}</p>}
    </div>
  )
}
