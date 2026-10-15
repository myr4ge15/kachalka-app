import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { friendsApi, pairState, requestStatusText } from '../../lib/friends.js'
import { getFriends, refreshFriends } from '../../db/friends.js'
import { showToast } from '../ui/Toast.jsx'

// Дружба в профиле участника (15.10.2026). Кнопка — только когда есть действие:
// «+ В друзья» или «Принять заявку». Уже друзья, заявка отправлена, заблокирован — тихая
// подпись под именем (`label`), без кнопки. Состояние — снимок fr_list (db/friends.js).
// Удалить и заблокировать — в «Друзьях».
const LABELS = { friend: 'в друзьях', outgoing: 'заявка в друзья отправлена', blocked: 'заблокирован(а)' }
// compact (v9.0.0, строка участника «Моего круга»): ссылка под именем вместо кнопки.
const COMPACT = { friend: 'друг', outgoing: 'заявка отправлена' }

export default function FriendButton({ me, memberId, label = false, compact = false }) {
  const rows = useLiveQuery(() => getFriends(), [me], undefined)
  const [busy, setBusy] = useState(false)
  if (!memberId || memberId === me || rows === undefined) return null
  const state = pairState(rows, memberId)

  if (label) {
    return LABELS[state] ? <div className="member-sub frd-member-note">{LABELS[state]}</div> : null
  }

  async function run(fn) {
    setBusy(true)
    try {
      const r = await fn()
      showToast({ emoji: r === 'accepted' ? '🤝' : '👋', title: requestStatusText(r) })
      await refreshFriends(me)
    } catch (e) {
      showToast({ emoji: '⚠️', title: e.message })
    } finally {
      setBusy(false)
    }
  }
  const api = friendsApi(me)

  if (compact) {
    if (COMPACT[state]) return <span className="muted frd-compact">{COMPACT[state]}</span>
    if (state !== 'none' && state !== 'incoming') return null
    return (
      <button type="button" className="link-btn frd-compact" disabled={busy}
        onClick={() => run(state === 'incoming'
          ? async () => { await api.respond(memberId, true); return 'accepted' }
          : () => api.request(memberId))}>
        {busy ? '…' : state === 'incoming' ? 'Принять в друзья' : '+ В друзья'}
      </button>
    )
  }
  if (state === 'incoming') {
    return (
      <button type="button" className="btn primary frd-btn" disabled={busy}
        onClick={() => run(async () => { await api.respond(memberId, true); return 'accepted' })}>
        Принять заявку в друзья
      </button>
    )
  }
  if (state !== 'none') return null
  return (
    <button type="button" className="btn ghost frd-btn" disabled={busy}
      onClick={() => run(() => api.request(memberId))}>
      {busy ? 'Отправляю…' : '+ В друзья'}
    </button>
  )
}
