import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getNotifications, getSeenAt, markAllSeen } from '../db/notifications.js'
import { cmpIsoAsc } from '../lib/cmp.js'

// «сегодня / вчера / дд.мм.гггг» + время (как в ленте).
function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date()
  const y = new Date()
  y.setDate(today.getDate() - 1)
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (sameDay(d, today)) return `сегодня · ${time}`
  if (sameDay(d, y)) return `вчера · ${time}`
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Экран «Уведомления»: личные рекорды и кто обходит тебя в кругу (ТЗ §4.5, MVP).
export default function NotificationsScreen({ user }) {
  const list = useLiveQuery(() => getNotifications(user.id), [user.id], undefined)
  const loading = list === undefined
  const items = list ?? []

  // Метка «было прочитано до открытия» фиксируется один раз на маунте — по ней
  // подсвечиваем непрочитанные. Затем двигаем метку вперёд (бейдж гаснет).
  const seenRef = useRef('')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    getSeenAt().then((s) => {
      if (alive) {
        seenRef.current = s
        setReady(true)
      }
    })
    return () => { alive = false }
  }, [])

  // Как только список и метка готовы — помечаем всё прочитанным (один раз).
  const marked = useRef(false)
  useEffect(() => {
    if (!ready || loading || marked.current) return
    marked.current = true
    markAllSeen(items)
  }, [ready, loading, items])

  const unreadCount = items.filter((n) => cmpIsoAsc(seenRef.current, n.at) < 0).length

  return (
    <div className="screen">
      <h2 className="screen-title">Уведомления</h2>
      <p className="muted sub">Твои рекорды и кто обходит тебя в кругу</p>

      {loading && <p className="muted">Загрузка…</p>}

      {!loading && items.length === 0 && (
        <p className="muted empty">Пока тихо. Новые рекорды появятся здесь 💪</p>
      )}

      {!loading && items.length > 0 && (
        <div className="muted notif-count">
          {unreadCount > 0 ? `${unreadCount} новых` : 'всё прочитано'}
        </div>
      )}

      {items.map((n) => {
        const unread = cmpIsoAsc(seenRef.current, n.at) < 0
        const icon = n.type === 'mine' ? '🏆' : n.type === 'goal' ? '🎯' : '🔥'
        const cls = 'notif ' + n.type + (unread ? ' unread' : ' read')
        return (
          <div key={n.id} className={cls}>
            <div className="n-icon" aria-hidden="true">{icon}</div>
            <div className="n-body">
              {n.type === 'mine' && (
                <>
                  <div className="n-title">
                    Личный рекорд · <span className="hl">{n.name}</span>
                  </div>
                  <div className="n-text">
                    Новый максимум: <b>{n.weight} кг</b>
                    {n.prev > 0 && ` (прошлый — ${n.prev} кг)`}
                  </div>
                </>
              )}
              {n.type === 'goal' && (
                <>
                  <div className="n-title">
                    Цель достигнута · <span className="hl">{n.name}</span>
                  </div>
                  <div className="n-text">
                    Ты дотянул до цели: <b>{n.weight} кг</b>
                  </div>
                </>
              )}
              {n.type === 'beaten' && (
                <>
                  <div className="n-title">Твой рекорд побит</div>
                  <div className="n-text">
                    <b>{n.who}</b> обошёл тебя в «{n.name}»: <b>{n.weight} кг</b>
                    {` (твой ${n.myWeight} кг)`}
                  </div>
                </>
              )}
              <div className="n-time">{fmtWhen(n.at)}</div>
            </div>
            {unread && <span className="n-dot" aria-hidden="true" />}
          </div>
        )
      })}
    </div>
  )
}
