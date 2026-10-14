import Chevron from '../ui/Chevron.jsx'
import { useEffect, useMemo, useState } from 'react'
import { useSyncStatus } from '../../db/sync.js'
import { memberInviteApi } from '../../lib/memberInvites.js'
import { createAdminCache } from '../../lib/adminCache.js'
import InvitesSection from './InvitesSection.jsx'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'

function Panel({ api, cache }) {
  const { online } = useSyncStatus()
  return <InvitesSection online={online} api={api} limit={3} errMsg={e => e.message} cache={cache} />
}

// v8.0.1: список приглашений грузится заранее (пока блок свернут) и держится в памяти,
// пока открыт профиль, — раскрытие показывает его сразу, без 0,3–0,5 с ожидания сети.
export default function MemberInvites({ userId }) {
  const [open, setOpen] = useState(false)
  const revealRef = useRevealFocus(open)
  const api = useMemo(() => memberInviteApi(userId), [userId])
  const cache = useMemo(() => createAdminCache(), [userId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine) cache.load('invites', () => api.list()).catch(() => {})
  }, [api, cache])
  return <div className="member-invites" ref={revealRef}>
    <button className="settings-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <span className="settings-title"><span aria-hidden="true">✉️</span> Пригласить участника</span>
      <Chevron className="settings-chev" open={open} />
    </button>
    {open && <Panel key={userId} api={api} cache={cache} />}
  </div>
}
