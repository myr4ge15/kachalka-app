import { useState } from 'react'
import Avatar from '../ui/Avatar.jsx'
import { usePresence } from '../../hooks/usePresence.js'
import { isOnline, presenceLabel } from '../../lib/presence.js'
import { groupFriends } from '../../lib/friends.js'

// Списки «Друзей» (вариант A, 15.10.2026: «как контакты»). Входящие заявки — карточкой
// сверху (Принять / Нет); друзья — строки: тап — профиль, «⋯» — меню (профиль, удалить,
// заблокировать; опасное — во второе нажатие); мои заявки — «Отозвать»; заблокированные —
// «Разблокировать». Отказ, удаление и блок другая сторона не видит.
export default function FriendLists({ rows, me, onAct, onOpenMember }) {
  const presence = usePresence(me)
  const [busy, setBusy] = useState('')
  const [menu, setMenu] = useState(null) // id друга с открытым «⋯»
  const [arm, setArm] = useState(null) // 'remove' | 'block' — ждет второго нажатия
  const g = groupFriends(rows)

  async function act(key, op, user) {
    setBusy(key)
    try {
      await onAct(op, user)
      setMenu(null); setArm(null)
    } finally {
      setBusy('')
    }
  }
  function toggleMenu(id) {
    setArm(null)
    setMenu((cur) => (cur === id ? null : id))
  }
  const seen = (r) => presence.get(r.user_id)
  const status = (r) => {
    if (isOnline(seen(r))) return <span className="fr-sub fr-sub-on">в сети</span>
    const l = presenceLabel(seen(r))
    return l ? <span className="fr-sub">{l}</span> : null
  }
  const avatar = (r, online = false) => (
    <Avatar name={r.name} url={r.avatar_url} className="avatar fr-av" online={online} />
  )

  return (
    <>
      {g.incoming.length > 0 && (
        <div className="card fr-card fr-card-hl">
          <p className="fr-lab">Хотят дружить · {g.incoming.length}</p>
          {g.incoming.map((r) => (
            <div key={r.user_id} className="fr-req">
              <div className="fr-row-static">
                {avatar(r)}
                <span className="fr-who"><span className="fr-name">{r.name}</span></span>
              </div>
              <div className="fr-two">
                <button type="button" className="btn primary" disabled={!!busy}
                  onClick={() => act(`ok-${r.user_id}`, 'accept', r.user_id)}>Принять</button>
                <button type="button" className="btn ghost" disabled={!!busy}
                  onClick={() => act(`no-${r.user_id}`, 'decline', r.user_id)}>Нет</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="fr-lab fr-lab-out">Друзья{g.friend.length ? ` · ${g.friend.length}` : ''}</p>
      {g.friend.length === 0 ? (
        <div className="card fr-card">
          <p className="muted fr-empty">Пока никого. Нажми «Добавить друга» и отправь свой код — или позови из круга: в профиле участника есть «В друзья».</p>
        </div>
      ) : (
        <div className="card fr-card fr-list">
          {g.friend.map((r) => (
            <div key={r.user_id} className="fr-item">
              <div className="fr-line">
                <button type="button" className="fr-row" onClick={() => onOpenMember?.(r.user_id)}>
                  {avatar(r, isOnline(seen(r)))}
                  <span className="fr-who"><span className="fr-name">{r.name}</span>{status(r)}</span>
                </button>
                <button type="button" className="fr-more" aria-label={`Действия: ${r.name}`}
                  aria-expanded={menu === r.user_id} onClick={() => toggleMenu(r.user_id)}>⋯</button>
              </div>
              {menu === r.user_id && (
                <div className="fr-menu" role="group" aria-label={r.name}>
                  <button type="button" onClick={() => onOpenMember?.(r.user_id)}>Открыть профиль</button>
                  <button type="button" disabled={!!busy}
                    onClick={() => (arm === 'remove' ? act(`rm-${r.user_id}`, 'remove', r.user_id) : setArm('remove'))}>
                    {arm === 'remove' ? 'Точно удалить из друзей?' : 'Удалить из друзей'}
                  </button>
                  <button type="button" className="fr-danger" disabled={!!busy}
                    onClick={() => (arm === 'block' ? act(`bl-${r.user_id}`, 'block', r.user_id) : setArm('block'))}>
                    {arm === 'block' ? 'Точно заблокировать?' : 'Заблокировать'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {g.outgoing.length > 0 && (
        <>
          <p className="fr-lab fr-lab-out">Мои заявки</p>
          <div className="card fr-card fr-list">
            {g.outgoing.map((r) => (
              <div key={r.user_id} className="fr-row-static">
                {avatar(r)}
                <span className="fr-who"><span className="fr-name">{r.name}</span><span className="fr-sub">ждет ответа</span></span>
                <button type="button" className="btn ghost fr-small" disabled={!!busy}
                  onClick={() => act(`cancel-${r.user_id}`, 'cancel', r.user_id)}>Отозвать</button>
              </div>
            ))}
          </div>
        </>
      )}

      {g.blocked.length > 0 && (
        <>
          <p className="fr-lab fr-lab-out">Заблокированные</p>
          <div className="card fr-card fr-list">
            {g.blocked.map((r) => (
              <div key={r.user_id} className="fr-row-static">
                {avatar(r)}
                <span className="fr-who"><span className="fr-name">{r.name}</span></span>
                <button type="button" className="btn ghost fr-small" disabled={!!busy}
                  onClick={() => act(`unblock-${r.user_id}`, 'unblock', r.user_id)}>Разблокировать</button>
              </div>
            ))}
          </div>
          <p className="muted fr-note">Заблокированный не видит твои тренировки нигде, даже в общем круге, и не может позвать тебя в друзья.</p>
        </>
      )}
    </>
  )
}
