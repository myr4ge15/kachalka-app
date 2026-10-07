import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { circleApi } from '../lib/friendCircles.js'
import { refreshMyCircles } from '../db/circles.js'
import { syncNow, useSyncStatus } from '../db/sync.js'
import { invalidateRatingCache } from '../db/disciplines.js'
import BackButton from '../components/BackButton.jsx'
import JoinByCode from '../components/circle/JoinByCode.jsx'
import CircleCode from '../components/circle/CircleCode.jsx'
import CircleMembers from '../components/circle/CircleMembers.jsx'
import CircleOwnerSettings from '../components/circle/CircleOwnerSettings.jsx'

// «Мой круг» (07.10.2026; сервер — supabase/friend-circles.sql). Свой круг (один) и круги,
// куда вступил по коду (до 5). У каждого участника — личный код: позвать друга без админа.
// Все active-участники круга видят друг друга в Ленте и рейтинге круга.
// Только онлайн. Пропсы: user, onBack(), joinCode — код из ссылки #join=… (или null).
export default function CircleScreen({ user, onBack, joinCode = null, onJoinCodeConsumed }) {
  const api = useMemo(() => circleApi(user.id), [user.id])
  const { online } = useSyncStatus()
  const [circles, setCircles] = useState(null)
  const [selected, setSelected] = useState(null)
  const [err, setErr] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = useCallback(async () => {
    if (!navigator.onLine) return
    try {
      const list = await api.myCircles()
      if (!alive.current) return
      setCircles(list); setErr('')
    } catch (e) {
      if (alive.current) setErr(e.message)
    }
  }, [api])
  useEffect(() => { load() }, [load, online])

  // Состав изменился — Лента, ростер и рейтинги должны это увидеть.
  const changed = useCallback(async () => {
    await load()
    refreshMyCircles(user.id)
    invalidateRatingCache().catch(() => {})
    if (navigator.onLine) syncNow(user.id)
  }, [load, user.id])

  const current = (circles ?? []).find((c) => c.circle_id === selected) ?? (circles ?? [])[0] ?? null
  const ownCircle = (circles ?? []).find((c) => c.is_owner)

  return (
    <div className="screen profile fc-screen">
      <div className="admin-head">
        <BackButton onClick={onBack} />
        <h2 className="admin-title">Мой круг</h2>
      </div>

      {!online && <div className="banner">«Мой круг» работает только с интернетом.</div>}
      {err && <div className="banner error" role="alert">{err}</div>}

      {joinCode && online && (
        <JoinByCode api={api} initialCode={joinCode} onJoined={(r) => { onJoinCodeConsumed?.(); setSelected(r?.circle_id ?? null); changed() }} />
      )}

      {circles === null && online && !err && <p className="muted" role="status">Загружаю…</p>}

      {circles && circles.length === 0 && (
        <div className="card fc-intro">
          <p className="fc-lead">Круг — это свои люди: все его участники видят тренировки друг друга, ставят реакции и соревнуются в рейтинге круга.</p>
          <p className="muted">Создай свой круг и позови друзей личным кодом — или вступи в круг друга по его коду.</p>
        </div>
      )}

      {circles && circles.length > 1 && (
        <div className="seg fc-tabs" role="group" aria-label="Круг">
          {circles.map((c) => (
            <button key={c.circle_id} type="button" className={'seg-item' + (c.circle_id === current?.circle_id ? ' on' : '')}
              aria-pressed={c.circle_id === current?.circle_id} onClick={() => setSelected(c.circle_id)}>
              {c.name}{c.pending > 0 ? ` · ${c.pending}` : ''}
            </button>
          ))}
        </div>
      )}

      {current && (
        <CirclePanel key={current.circle_id} api={api} circle={current} me={user.id}
          onChanged={changed} onGone={() => { setSelected(null); changed() }} />
      )}

      {circles && !ownCircle && online && <CreateCircle api={api} onCreated={(id) => { setSelected(id); changed() }} />}
      {circles && online && !joinCode && <JoinByCode api={api} onJoined={(r) => { setSelected(r?.circle_id ?? null); changed() }} />}
    </div>
  )
}

function CirclePanel({ api, circle, me, onChanged, onGone }) {
  const [armLeave, setArmLeave] = useState(false)
  const [err, setErr] = useState('')
  if (circle.my_status === 'pending') {
    return (
      <div className="card fc-pending-card">
        <h3 className="fc-h">«{circle.name}»</h3>
        <p className="muted">Заявка отправлена — {circle.owner_name} решит. Пока ждешь, круг тебя не видит, и ты его тоже.</p>
      </div>
    )
  }
  async function leave() {
    try {
      const r = await api.leave(circle.circle_id)
      if (r === 'owner') { setErr('Владелец не может выйти — передай круг или удали его.'); return }
      onGone()
    } catch (e) {
      setErr(e.message)
    }
  }
  return (
    <>
      <div className="fc-title-row">
        <h3 className="fc-circle-name">«{circle.name}»</h3>
        <span className="muted">{circle.is_owner ? 'твой круг' : `круг ${circle.owner_name}`} · {circle.members} {plural(circle.members)}</span>
      </div>
      <CircleCode api={api} circle={circle} />
      <CircleMembers api={api} circle={circle} me={me} onChanged={onChanged} />
      {circle.is_owner ? (
        <CircleOwnerSettings api={api} circle={circle} onChanged={onChanged} onDeleted={onGone} />
      ) : (
        <div className="fc-danger">
          {armLeave ? (
            <div className="danger-confirm">
              <p className="danger-text">Выйти из «{circle.name}»? Участники перестанут видеть твои тренировки (если вас не связывает что-то еще), твой код сгорит.</p>
              <div className="danger-actions">
                <button type="button" className="btn ghost" onClick={() => setArmLeave(false)}>Отмена</button>
                <button type="button" className="btn danger" onClick={leave}>Выйти</button>
              </div>
            </div>
          ) : (
            <button type="button" className="act danger" onClick={() => setArmLeave(true)}>Выйти из круга</button>
          )}
        </div>
      )}
      {err && <p className="pin-err" role="alert">{err}</p>}
    </>
  )
}

function plural(n) {
  const a = n % 10, b = n % 100
  if (a === 1 && b !== 11) return 'участник'
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'участника'
  return 'участников'
}

function CreateCircle({ api, onCreated }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function create(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const id = await api.create(name)
      setOpen(false); setName('')
      onCreated(id)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }
  if (!open) return <button type="button" className="btn primary fc-create-btn" onClick={() => setOpen(true)}>Создать свой круг</button>
  return (
    <form className="card fc-create" onSubmit={create} noValidate>
      <h3 className="fc-h">Свой круг</h3>
      <div className="field">
        <label className="field-lab" htmlFor="fc-new-name">Название</label>
        <input id="fc-new-name" className="admin-input" maxLength={40} placeholder="Например, «Зал на Ленина»" autoFocus
          value={name} disabled={busy} onChange={(e) => { setName(e.target.value); setErr('') }} />
      </div>
      {err && <p className="pin-err" role="alert">{err}</p>}
      <div className="fc-actions">
        <button type="button" className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>Отмена</button>
        <button type="submit" className="btn primary" disabled={busy || !name.trim()}>{busy ? 'Создаю…' : 'Создать'}</button>
      </div>
    </form>
  )
}
