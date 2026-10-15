import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { friendsApi, pairState, requestStatusText } from '../../lib/friends.js'
import { getFriends, refreshFriends } from '../../db/friends.js'
import { showToast } from '../ui/Toast.jsx'

// Кнопка дружбы в профиле участника: «В друзья» / «Заявка отправлена» / «Принять заявку» /
// «Друзья ✓». Состояние — снимок fr_list (db/friends.js); действие — онлайн.
// Удалить и заблокировать — в «Друзьях» (там же, где список).
export default function FriendButton({ me, memberId, onOpenFriends }) {
  const rows = useLiveQuery(() => getFriends(), [me], undefined)
  const [busy, setBusy] = useState(false)
  if (!memberId || memberId === me || rows === undefined) return null
  const state = pairState(rows, memberId)

  async function run(fn) {
    setBusy(true)
    try {
      const r = await fn()
      if (typeof r === 'string') showToast({ emoji: r === 'accepted' ? '🤝' : '👋', title: requestStatusText(r) })
      await refreshFriends(me)
    } catch (e) {
      showToast({ emoji: '⚠️', title: e.message })
    } finally {
      setBusy(false)
    }
  }
  const api = friendsApi(me)

  if (state === 'friend') {
    return <button type="button" className="btn ghost fr-btn" onClick={onOpenFriends}>Друзья ✓</button>
  }
  if (state === 'outgoing') {
    return <button type="button" className="btn ghost fr-btn" disabled>Заявка отправлена</button>
  }
  if (state === 'incoming') {
    return (
      <button type="button" className="btn primary fr-btn" disabled={busy}
        onClick={() => run(async () => { await api.respond(memberId, true); return 'accepted' })}>
        Принять заявку в друзья
      </button>
    )
  }
  if (state === 'blocked') {
    return <button type="button" className="btn ghost fr-btn" onClick={onOpenFriends}>Заблокирован</button>
  }
  return (
    <button type="button" className="btn primary fr-btn" disabled={busy}
      onClick={() => run(() => api.request(memberId))}>
      {busy ? 'Отправляю…' : 'В друзья'}
    </button>
  )
}
