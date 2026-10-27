import { useState } from 'react'
import MenuRow from '../ui/MenuRow.jsx'
import { showToast } from '../ui/Toast.jsx'
import { useAliveRef } from '../../hooks/useAliveRef.js'
import { useViewAll } from '../../hooks/useViewAll.js'
import { enableViewAll, disableViewAll } from '../../db/adminViewAll.js'
import { VIEW_ALL_CHOICES, leftLabel, viewAllActive } from '../../lib/viewAll.js'

// Раздел Админки «Видеть всех» (27.10.2026, PLAN-admin-view-all.md): на время Лента, профили,
// комментарии и «в сети» показывают всех участников, а не только друзей и круги. Только
// просмотр: реакции и комментарии «чужим» сервер не примет. Срок держит сервер.
export default function ViewAllSection({ userId, online }) {
  const state = useViewAll()
  const active = viewAllActive(state)
  const [busy, setBusy] = useState(false)
  const alive = useAliveRef()

  async function run(fn, done) {
    setBusy(true)
    try {
      await fn()
      showToast(done)
    } catch (e) {
      showToast({ icon: 'alert', title: 'Не получилось', sub: e?.message ?? String(e) })
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const off = online ? null : 'Нет сети'
  return (
    <>
      <p className="admin-hint">
        Лента, профили, комментарии и «в сети» — у всех участников, а не только у друзей и кругов.
        Только просмотр: отвечать и ставить реакции «чужим» нельзя. Режим выключится сам.
      </p>
      <div className="menu-group viewall-group">
        {active ? (
          <MenuRow kind="action" icon="eyeoff" title="Выключить" sub={`осталось ${leftLabel(state.until)}`}
            disabled={busy || !online}
            onClick={() => run(() => disableViewAll(userId), { icon: 'eyeoff', title: 'Режим выключен' })} />
        ) : VIEW_ALL_CHOICES.map(({ minutes, label }) => (
          <MenuRow key={minutes} kind="action" icon="eye" title={label} sub={off}
            disabled={busy || !online}
            onClick={() => run(() => enableViewAll(userId, minutes), { icon: 'eye', title: 'Видно всех', sub: label.toLowerCase() })} />
        ))}
      </div>
    </>
  )
}
