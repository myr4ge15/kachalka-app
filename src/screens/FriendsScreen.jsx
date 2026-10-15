import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { friendsApi } from '../lib/friends.js'
import { getFriends, refreshFriends } from '../db/friends.js'
import { syncNow, useSyncStatus } from '../db/sync.js'
import { invalidateRatingCache } from '../db/disciplines.js'
import BackButton from '../components/ui/BackButton.jsx'
import FriendCode from '../components/friends/FriendCode.jsx'
import FriendByCode from '../components/friends/FriendByCode.jsx'
import FriendLists from '../components/friends/FriendLists.jsx'
import SheetDialog from '../components/ui/SheetDialog.jsx'

// «Друзья» (этап 1, 15.10.2026; сервер — supabase/friends.sql). Взаимная дружба: свой код
// (сразу друзья), заявки из круга и профиля участника, удалить/заблокировать. Друзья видят
// тренировки друг друга. Список — снимок в meta (db/friends.js), действия — только онлайн.
// Пропсы: user, onBack(), onOpenMember(id), friendCode — код из ссылки #friend=… (или null).
export default function FriendsScreen({ user, onBack, onOpenMember, friendCode = null, onFriendCodeConsumed }) {
  const api = useMemo(() => friendsApi(user.id), [user.id])
  const { online } = useSyncStatus()
  const rows = useLiveQuery(() => getFriends(), [user.id], undefined)
  const [err, setErr] = useState('')
  // «Добавить друга» — лист со своим кодом и вводом чужого (вариант A, 15.10.2026). Во весь
  // экран — закрывается свайпом вправо, как вложенный экран (v8.9.3; было — вниз).
  const [adding, setAdding] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = useCallback(async () => {
    if (!navigator.onLine) return
    const items = await refreshFriends(user.id)
    if (alive.current) setErr(items ? '' : 'Не получилось обновить список. Проверь связь.')
  }, [user.id])
  useEffect(() => { load() }, [load, online])

  // Видимость изменилась — Лента, ростер и рейтинги должны это увидеть.
  const changed = useCallback(async () => {
    await load()
    invalidateRatingCache().catch(() => {})
    if (navigator.onLine) syncNow(user.id)
  }, [load, user.id])

  async function onAct(op, other) {
    setErr('')
    try {
      if (op === 'accept') await api.respond(other, true)
      else if (op === 'decline') await api.respond(other, false)
      else await api[op](other)
      await changed()
    } catch (e) {
      if (alive.current) setErr(e.message)
    }
  }

  return (
    <div className="screen profile fc-screen">
      <div className="admin-head">
        <BackButton onClick={onBack} />
        <h2 className="admin-title">Друзья</h2>
      </div>

      {!online && <div className="banner">Изменить друзей можно только с интернетом.</div>}
      {err && <div className="banner error" role="alert">{err}</div>}

      {friendCode && online && (
        <FriendByCode api={api} initialCode={friendCode} onAdded={() => { onFriendCodeConsumed?.(); changed() }} />
      )}

      {rows === undefined && <p className="muted" role="status">Загружаю…</p>}
      {rows === null && online && !err && <p className="muted" role="status">Загружаю…</p>}
      {rows && <FriendLists rows={rows} me={user.id} onAct={onAct} onOpenMember={onOpenMember} />}

      {online && (
        <button type="button" className="btn primary frd-add" onClick={() => setAdding(true)}>+ Добавить друга</button>
      )}
      {adding && (
        <SheetDialog title="Добавить друга" onDismiss={() => setAdding(false)} swipeBack className="frd-sheet">
          <FriendCode api={api} myName={user.name} />
          <FriendByCode api={api} onAdded={changed} />
        </SheetDialog>
      )}
    </div>
  )
}
