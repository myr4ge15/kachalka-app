import { useState } from 'react'
import Avatar from '../ui/Avatar.jsx'
import { usePresence } from '../../hooks/usePresence.js'
import { isOnline } from '../../lib/presence.js'
import { groupFriends } from '../../lib/friends.js'

// Списки «Друзей»: входящие заявки (принять/отклонить), друзья (профиль, удалить,
// заблокировать), исходящие (отозвать), заблокированные (разблокировать). Действия с
// последствиями — в два нажатия. Отказ, удаление и блок другая сторона не видит.
export default function FriendLists({ rows, me, onAct, onOpenMember }) {
  const presence = usePresence(me)
  const [busy, setBusy] = useState('')
  const [arm, setArm] = useState(null) // { kind: 'remove' | 'block', id }
  const g = groupFriends(rows)
  const armed = (kind, id) => arm?.kind === kind && arm?.id === id

  async function act(key, op, user) {
    setBusy(key)
    try {
      await onAct(op, user)
      setArm(null)
    } finally {
      setBusy('')
    }
  }
  const twoStep = (kind, id, label, armedLabel, op) => (
    <button type="button" className={armed(kind, id) ? 'link-btn danger' : 'link-btn muted'} disabled={!!busy}
      onClick={() => (armed(kind, id) ? act(`${kind}-${id}`, op, id) : setArm({ kind, id }))}>
      {armed(kind, id) ? armedLabel : label}
    </button>
  )
  const who = (r) => (
    <Avatar name={r.name} url={r.avatar_url} className="avatar-sm"
      online={r.state === 'friend' && isOnline(presence.get(r.user_id))} />
  )

  return (
    <>
      {g.incoming.length > 0 && (
        <div className="card fc-members">
          <h3 className="fc-h">Хотят дружить · {g.incoming.length}</h3>
          <ul className="fc-list">
            {g.incoming.map((r) => (
              <li key={r.user_id} className="fc-row">
                {who(r)}
                <span className="fc-who"><span className="fc-name">{r.name}</span></span>
                <span className="fc-row-acts">
                  <button type="button" className="btn primary fc-mini" disabled={!!busy}
                    onClick={() => act(`ok-${r.user_id}`, 'accept', r.user_id)}>Принять</button>
                  <button type="button" className="btn ghost fc-mini" disabled={!!busy}
                    onClick={() => act(`no-${r.user_id}`, 'decline', r.user_id)}>Нет</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card fc-members">
        <h3 className="fc-h">Друзья{g.friend.length ? ` · ${g.friend.length}` : ''}</h3>
        {g.friend.length === 0 && (
          <p className="muted">Пока никого. Отправь свой код другу — или позови из круга: в профиле участника есть «В друзья».</p>
        )}
        <ul className="fc-list">
          {g.friend.map((r) => (
            <li key={r.user_id} className="fc-row">
              {who(r)}
              <span className="fc-who">
                <button type="button" className="link-btn fc-name" onClick={() => onOpenMember?.(r.user_id)}>{r.name}</button>
              </span>
              <span className="fc-row-acts fc-under">
                {twoStep('remove', r.user_id, 'Удалить из друзей', 'Точно удалить?', 'remove')}
                {twoStep('block', r.user_id, 'Заблокировать', 'Точно заблокировать?', 'block')}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {g.outgoing.length > 0 && (
        <div className="card fc-members">
          <h3 className="fc-h">Мои заявки</h3>
          <ul className="fc-list">
            {g.outgoing.map((r) => (
              <li key={r.user_id} className="fc-row">
                {who(r)}
                <span className="fc-who"><span className="fc-name">{r.name}</span><span className="muted fc-by">ждет ответа</span></span>
                <span className="fc-row-acts">
                  <button type="button" className="link-btn muted" disabled={!!busy}
                    onClick={() => act(`cancel-${r.user_id}`, 'cancel', r.user_id)}>Отозвать</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {g.blocked.length > 0 && (
        <div className="card fc-members">
          <h3 className="fc-h">Заблокированные</h3>
          <p className="muted fc-msg">Вы не видите тренировки друг друга нигде, даже в общем круге, и они не могут позвать тебя в друзья.</p>
          <ul className="fc-list">
            {g.blocked.map((r) => (
              <li key={r.user_id} className="fc-row">
                {who(r)}
                <span className="fc-who"><span className="fc-name">{r.name}</span></span>
                <span className="fc-row-acts">
                  <button type="button" className="link-btn muted" disabled={!!busy}
                    onClick={() => act(`unblock-${r.user_id}`, 'unblock', r.user_id)}>Разблокировать</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
