// Секция Админки «Доступ к тренировкам» (вынесена из screens/AdminScreen.jsx, v6.14.1).
import { useEffect, useMemo, useRef, useState } from 'react'
import { adminListUsers, adminListConnections, adminSetConnection } from '../../lib/admin.js'
import { connectedIdsFor } from '../../lib/connections.js'
import { showToast } from '../Toast.jsx'
import CardsSkeleton from '../CardsSkeleton.jsx'

// ─────────────────────── Доступ к тренировкам (связи) ──────────────────────
// Админ-управляемые связи «избранного круга» (v3.14.0). Приватный виден только
// себе и админу; здесь админ открывает ВЗАИМНЫЙ доступ между приватным участником
// и выбранными людьми (оба начинают видеть тренировки друг друга). В общий рейтинг
// приватный все равно не попадает (см. supabase/connections.sql). Все — online-RPC
// с гейтом is_admin(), локального кэша нет.
export default function AccessSection({ meId, online, errMsg }) {
  const [users, setUsers] = useState(null)
  const [pairs, setPairs] = useState([])
  const [sel, setSel] = useState('')
  const [loadErr, setLoadErr] = useState('')
  const [busyId, setBusyId] = useState(null)

  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function reload() {
    setLoadErr('')
    try {
      const [list, cons] = await Promise.all([adminListUsers(), adminListConnections()])
      if (!alive.current) return
      setUsers(list)
      setPairs(cons)
      setSel((cur) => cur || (list.find((u) => u.is_private)?.id ?? ''))
    } catch (e) {
      if (!alive.current) return
      setLoadErr(errMsg(e)); setUsers([])
    }
  }
  // Перезагрузка ТОЛЬКО на смену online. `reload` намеренно вне deps: он
  // пересоздается каждый рендер, но всегда делает один и тот же fetch, а
  // stale-сеттеры после размонтирования отсекает alive-ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (online) reload(); else setUsers([]) }, [online])

  const privateUsers = (users ?? []).filter((u) => u.is_private)
  const connected = useMemo(() => connectedIdsFor(pairs, sel), [pairs, sel])

  async function toggle(otherId, on) {
    if (!sel) return
    setBusyId(otherId)
    // оптимистично правим локальный набор пар (галочка реагирует сразу)
    const lo = sel < otherId ? sel : otherId
    const hi = sel < otherId ? otherId : sel
    setPairs((prev) => {
      const rest = prev.filter((p) => !(p.low_id === lo && p.high_id === hi))
      return on ? [...rest, { low_id: lo, high_id: hi, status: 'accepted' }] : rest
    })
    try {
      await adminSetConnection(sel, otherId, on)
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: errMsg(e) })
      reload() // откат к серверной правде
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="sec">
      {loadErr && <p className="admin-offline" role="alert">{loadErr}</p>}
      {users === null && <CardsSkeleton cards={4} />}

      {users !== null && privateUsers.length === 0 && (
        <p className="admin-hint">
          Нет приватных участников. Сделай кого-то приватным в разделе «Пользователи»,
          затем открой ему доступ к нужным людям здесь.
        </p>
      )}

      {privateUsers.length > 0 && (
        <>
          <label className="field">
            <span className="field-lab">Приватный участник</span>
            <select className="prog-select" value={sel} onChange={(e) => setSel(e.target.value)}>
              {privateUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          <p className="admin-hint">
            Отметь, кто видит тренировки этого участника — и он видит их. Доступ взаимный.
            В общий рейтинг приватный при этом не попадает.
          </p>
          <ul className="admin-list">
            {(users ?? []).filter((u) => u.id !== sel).map((u) => (
              <li key={u.id} className="admin-user">
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={connected.has(u.id)}
                    disabled={!online || busyId === u.id}
                    onChange={(e) => toggle(u.id, e.target.checked)}
                  />
                  <span>
                    {u.name}
                    {u.id === meId && <span className="admin-you">я</span>}
                    {u.is_private ? ' · 🔒' : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
