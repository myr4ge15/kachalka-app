// Порядок учеток на экране входа — часть секции «Пользователи» (вынесено из screens/AdminScreen.jsx, v6.14.1).
import { useEffect, useRef, useState } from 'react'
import { showToast } from '../Toast.jsx'

// Перетаскивание учеток для задания порядка на экране входа. Pointer Events
// (работает на тач-экранах: setPointerCapture + touch-action:none на ручке).
// Порядок мутируется локально при перетаскивании, на сервер уходит одним RPC.
export default function UserReorderList({ users, meId, onCancel, onSave, errMsg }) {
  const [order, setOrder] = useState(users)
  const [dragId, setDragId] = useState(null)
  const [busy, setBusy] = useState(false)
  const orderRef = useRef(order)
  const rowEls = useRef({})
  useEffect(() => { orderRef.current = order }, [order])

  function startDrag(e, id) {
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* нет capture — ок */ }
    setDragId(id)
  }
  function onMove(e) {
    if (dragId == null) return
    const y = e.clientY
    const cur = orderRef.current
    let target = cur.length - 1
    for (let i = 0; i < cur.length; i++) {
      const el = rowEls.current[cur[i].id]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (y < r.top + r.height / 2) { target = i; break }
    }
    const from = cur.findIndex((u) => u.id === dragId)
    if (from !== -1 && from !== target) setOrder(moveItem(cur, from, target))
  }
  function endDrag(e) {
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ок */ }
    setDragId(null)
  }

  const changed = order.some((u, i) => u.id !== users[i]?.id)

  async function save() {
    setBusy(true)
    try {
      await onSave(order.map((u) => u.id))
    } catch (e) {
      setBusy(false)
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: errMsg(e) })
    }
  }

  return (
    <div className="user-reorder">
      <p className="admin-hint">Перетащи за ☰, чтобы задать порядок учеток на экране входа.</p>
      <ul className="admin-list reorder">
        {order.map((u) => (
          <li
            key={u.id}
            ref={(el) => { rowEls.current[u.id] = el }}
            className={'admin-user reorder-row' + (dragId === u.id ? ' dragging' : '')}
          >
            <span
              className="user-drag-handle"
              onPointerDown={(e) => startDrag(e, u.id)}
              onPointerMove={onMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              role="button"
              aria-label={`Перетащить ${u.name}`}
            >☰</span>
            <span className="admin-ex-name">
              {u.name}
              {u.id === meId && <span className="admin-you">я</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="admin-ex-actions">
        <button className="btn ghost" onClick={onCancel} disabled={busy}>Отмена</button>
        <button className="btn primary" onClick={save} disabled={busy || !changed}>
          {busy ? 'Сохраняю…' : 'Сохранить порядок'}
        </button>
      </div>
    </div>
  )
}

function moveItem(arr, from, to) {
  const a = [...arr]
  const [x] = a.splice(from, 1)
  a.splice(to, 0, x)
  return a
}
