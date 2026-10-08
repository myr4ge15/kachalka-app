import Chevron from './Chevron.jsx'
import { useMemo, useState } from 'react'
import { useSyncStatus } from '../db/sync.js'
import { memberInviteApi } from '../lib/memberInvites.js'
import InvitesSection from './InvitesSection.jsx'
import { useRevealFocus } from '../hooks/useRevealFocus.js'

function Panel({ userId }) {
  const { online } = useSyncStatus()
  const api = useMemo(() => memberInviteApi(userId), [userId])
  return <InvitesSection online={online} api={api} limit={3} errMsg={e => e.message} />
}

export default function MemberInvites({ userId }) {
  const [open, setOpen] = useState(false)
  const revealRef = useRevealFocus(open)
  return <div className="member-invites" ref={revealRef}>
    <button className="settings-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <span className="settings-title"><span aria-hidden="true">✉️</span> Пригласить участника</span>
      <Chevron className="settings-chev" open={open} />
    </button>
    {open && <Panel key={userId} userId={userId} />}
  </div>
}
