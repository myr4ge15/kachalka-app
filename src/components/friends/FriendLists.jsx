import { useState } from 'react'
import Avatar from '../ui/Avatar.jsx'
import MoreMenu from '../ui/MoreMenu.jsx'
import { usePresence, useRosterSex } from '../../hooks/usePresence.js'
import { isOnline, presenceLabel } from '../../lib/presence.js'
import { groupFriends } from '../../lib/friends.js'

// Списки «Друзей» (вариант A, 15.10.2026: «как контакты»). Входящие заявки — карточкой
// сверху (Принять / Нет); друзья — строки: тап — профиль, «⋯» — выпадающее меню (ui/MoreMenu, 9.5.4: профиль, удалить,
// заблокировать; опасное — во второе нажатие); мои заявки — «Отозвать»; заблокированные —
// «Разблокировать». Отказ, удаление и блок другая сторона не видит.
export default function FriendLists({ rows, me, onAct, onOpenMember }) {
  const presence = usePresence(me)
  const sexOf = useRosterSex()
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
  function closeMenu() {
    if (busy) return // идет удаление/блок — меню закроет act
    setMenu(null); setArm(null)
  }
  function toggleMenu(id) {
    setArm(null)
    setMenu((cur) => (cur === id ? null : id))
  }
  const seen = (r) => presence.get(r.user_id)
  const status = (r) => {
    if (isOnline(seen(r))) return <span className="frd-sub frd-sub-on">в сети</span>
    const l = presenceLabel(seen(r), { sex: sexOf.get(r.user_id) ?? null })
    return l ? <span className="frd-sub">{l}</span> : null
  }
  const avatar = (r, online = false) => (
    <Avatar name={r.name} url={r.avatar_url} className="avatar frd-av" online={online} />
  )

  return (
    <>
      {g.incoming.length > 0 && (
        <div className="card frd-card frd-card-hl">
          <p className="frd-lab">Хотят дружить · {g.incoming.length}</p>
          {g.incoming.map((r) => (
            <div key={r.user_id} className="frd-req">
              <div className="frd-row-static">
                {avatar(r)}
                <span className="frd-who"><span className="frd-name">{r.name}</span></span>
              </div>
              <div className="frd-two">
                <button type="button" className="btn primary" disabled={!!busy}
                  onClick={() => act(`ok-${r.user_id}`, 'accept', r.user_id)}>Принять</button>
                <button type="button" className="btn ghost" disabled={!!busy}
                  onClick={() => act(`no-${r.user_id}`, 'decline', r.user_id)}>Нет</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Пустой список — без подписи «Друзья» прямо под заголовком экрана «Друзья» (fb_976e29fd). */}
      {g.friend.length > 0 && <p className="frd-lab frd-lab-out">Друзья · {g.friend.length}</p>}
      {g.friend.length === 0 ? (
        <div className="card frd-card">
          <p className="muted frd-empty">Пока никого. Нажми «Добавить друга» и отправь другу свой код.</p>
        </div>
      ) : (
        <div className="card frd-card frd-list">
          {g.friend.map((r) => (
            <div key={r.user_id} className="frd-item">
              <div className="frd-line">
                <button type="button" className="frd-row" onClick={() => onOpenMember?.(r.user_id)}>
                  {avatar(r, isOnline(seen(r)))}
                  <span className="frd-who"><span className="frd-name">{r.name}</span>{status(r)}</span>
                </button>
                <MoreMenu label={`Действия: ${r.name}`} btnClassName="frd-more" open={menu === r.user_id}
                  onToggle={() => toggleMenu(r.user_id)} onClose={closeMenu}>
                  <button type="button" role="menuitem" onClick={() => { closeMenu(); onOpenMember?.(r.user_id) }}>
                    Открыть профиль
                  </button>
                  <button type="button" role="menuitem" disabled={!!busy}
                    onClick={() => (arm === 'remove' ? act(`rm-${r.user_id}`, 'remove', r.user_id) : setArm('remove'))}>
                    {arm === 'remove' ? 'Точно удалить из друзей?' : 'Удалить из друзей'}
                  </button>
                  <button type="button" role="menuitem" className="danger" disabled={!!busy}
                    onClick={() => (arm === 'block' ? act(`bl-${r.user_id}`, 'block', r.user_id) : setArm('block'))}>
                    {arm === 'block' ? 'Точно заблокировать?' : 'Заблокировать'}
                  </button>
                </MoreMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {g.outgoing.length > 0 && (
        <>
          <p className="frd-lab frd-lab-out">Мои заявки</p>
          <div className="card frd-card frd-list">
            {g.outgoing.map((r) => (
              <div key={r.user_id} className="frd-row-static">
                {avatar(r)}
                <span className="frd-who"><span className="frd-name">{r.name}</span><span className="frd-sub">ждет ответа</span></span>
                <button type="button" className="btn ghost frd-small" disabled={!!busy}
                  onClick={() => act(`cancel-${r.user_id}`, 'cancel', r.user_id)}>Отозвать</button>
              </div>
            ))}
          </div>
        </>
      )}

      {g.blocked.length > 0 && (
        <>
          <p className="frd-lab frd-lab-out">Заблокированные</p>
          <div className="card frd-card frd-list">
            {g.blocked.map((r) => (
              <div key={r.user_id} className="frd-row-static">
                {avatar(r)}
                <span className="frd-who"><span className="frd-name">{r.name}</span></span>
                <button type="button" className="btn ghost frd-small" disabled={!!busy}
                  onClick={() => act(`unblock-${r.user_id}`, 'unblock', r.user_id)}>Разблокировать</button>
              </div>
            ))}
          </div>
          <p className="muted frd-note">Заблокированный не видит твои тренировки нигде, даже в общем круге, и не может позвать тебя в друзья.</p>
        </>
      )}
    </>
  )
}
