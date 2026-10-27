import { useEffect, useState } from 'react'
import Icon from '../ui/Icon.jsx'
import { showToast } from '../ui/Toast.jsx'
import { useAliveRef } from '../../hooks/useAliveRef.js'
import { disableViewAll } from '../../db/adminViewAll.js'
import { leftLabel } from '../../lib/viewAll.js'

// Плашка режима «Видеть всех» под шапкой (27.10.2026, PLAN-admin-view-all.md): пока режим идет,
// админ видит всех — плашка не дает забыть. Остаток — раз в 30 с; «Выключить» — сразу.
export default function ViewAllBanner({ userId, until }) {
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const alive = useAliveRef()
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  async function off() {
    setBusy(true)
    try {
      await disableViewAll(userId)
      showToast({ icon: 'eyeoff', title: 'Режим выключен' })
    } catch (e) {
      showToast({ icon: 'alert', title: 'Не выключился', sub: e?.message ?? String(e) })
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <div className="viewall-bar" role="status">
      <Icon name="eye" size={18} className="viewall-ico" />
      <span className="viewall-txt">
        <b>Видно всех</b> · осталось {leftLabel(until, now)}
      </span>
      <button type="button" className="btn btn--sm ghost" onClick={off} disabled={busy}>
        {busy ? 'Выключаю…' : 'Выключить'}
      </button>
    </div>
  )
}
