// Порядок учеток на экране входа — часть секции «Пользователи» (вынесено из screens/AdminScreen.jsx, v6.14.1).
import { useState } from 'react'
import { showToast } from '../Toast.jsx'
import { useSortable } from '../../hooks/useSortable.js'
import { reorderById } from '../../lib/reorderById.js'

// Порядок учеток для экрана входа. Общая механика hooks/useSortable (v7.1.2):
// за ☰ строка поднимается и едет за пальцем, соседи расступаются; Alt+↑/↓ на ☰.
// Порядок меняется локально, на сервер уходит одним RPC по «Сохранить порядок».
export default function UserReorderList({ users, meId, onCancel, onSave, errMsg }) {
  const [order, setOrder] = useState(users)
  const [busy, setBusy] = useState(false)
  const sortRef = useSortable((id, beforeId) => {
    setOrder((prev) => reorderById(prev, id, beforeId, (u) => u.id))
  }, { attr: 'data-user-id', handle: '.user-drag-handle' })

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
      <ul className="admin-list reorder" ref={sortRef}>
        {order.map((u) => (
          <li key={u.id} data-user-id={u.id} className="admin-user reorder-row">
            <span
              className="user-drag-handle"
              role="button"
              tabIndex={0}
              aria-label={`Перетащить ${u.name}`}
              title="Перетащить (или Alt + ↑/↓)"
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
