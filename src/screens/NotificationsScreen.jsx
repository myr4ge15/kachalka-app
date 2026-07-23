import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getNotifications, getSeenAt, markAllSeen } from '../db/notifications.js'
import { cmpIsoAsc } from '../lib/cmp.js'
import { fmtWhen } from '../lib/dates.js'
import { fmtMetricValue } from '../lib/metric.js'
import CardsSkeleton from '../components/CardsSkeleton.jsx'
import { filterNotifs, activeCategories } from '../lib/notifFilter.js'

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
    getSeenAt(user.id).then((s) => {
      if (alive) {
        seenRef.current = s
        setReady(true)
      }
    })
    return () => { alive = false }
  }, [user.id])

  // Как только список и метка готовы — помечаем всё прочитанным (один раз).
  const marked = useRef(false)
  useEffect(() => {
    if (!ready || loading || marked.current) return
    marked.current = true
    markAllSeen(user.id, items)
  }, [ready, loading, items, user.id])

  // Непрочитанные и «прочитано» считаем по ПОЛНОМУ списку — фильтр-чипы влияют
  // только на рендер, но не гасят бейдж выборочно.
  const unreadCount = items.filter((n) => cmpIsoAsc(seenRef.current, n.at) < 0).length

  // Фильтр-чипы: показываем только реально присутствующие категории. Если
  // выбранная категория опустела (данные изменились) — откатываемся на «Все».
  const [filter, setFilter] = useState('all')
  const cats = activeCategories(items)
  const activeFilter = cats.some((c) => c.key === filter) ? filter : 'all'
  const shown = filterNotifs(items, activeFilter)

  return (
    <div className="screen">
      <h2 className="screen-title">Уведомления</h2>
      <p className="muted sub">Твои рекорды, реакции друзей и кто обходит тебя в кругу</p>

      {loading && <CardsSkeleton cards={4} />}

      {!loading && items.length === 0 && (
        <p className="muted empty">Пока тихо. Новые рекорды появятся здесь 💪</p>
      )}

      {!loading && items.length > 0 && (
        <div className="muted notif-count">
          {unreadCount > 0 ? `${unreadCount} новых` : 'всё прочитано'}
        </div>
      )}

      {!loading && cats.length > 2 && (
        <div className="chips" role="tablist" aria-label="Фильтр уведомлений">
          {cats.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={activeFilter === c.key}
              className={'chip' + (activeFilter === c.key ? ' active' : '')}
              onClick={() => setFilter(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {shown.map((n) => {
        const unread = cmpIsoAsc(seenRef.current, n.at) < 0
        const icon =
          n.type === 'mine' ? '🏆'
          : n.type === 'goal' ? '🎯'
          : n.type === 'reaction' ? (n.emojis?.[0] ?? '👏')
          : n.type === 'insight' ? (n.emoji ?? '💡')
          : n.type === 'badge' ? (n.emoji ?? '🏅')
          : '🔥'
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
                    Новый максимум: <b>{fmtMetricValue(n.metric, n.value)}</b>
                    {n.prev > 0 && ` (прошлый — ${fmtMetricValue(n.metric, n.prev)})`}
                  </div>
                </>
              )}
              {n.type === 'goal' && (
                <>
                  <div className="n-title">
                    Цель достигнута · <span className="hl">{n.name}</span>
                  </div>
                  <div className="n-text">
                    Ты дотянул до цели: <b>{fmtMetricValue(n.metric, n.value)}</b>
                  </div>
                </>
              )}
              {n.type === 'reaction' && (
                <>
                  <div className="n-title">
                    Реакция на тренировку · <span className="hl">{n.who}</span>
                  </div>
                  <div className="n-text">
                    Оценил твою тренировку: <b>{(n.emojis ?? []).join(' ')}</b>
                  </div>
                </>
              )}
              {n.type === 'insight' && (
                <>
                  <div className="n-title">Вывод</div>
                  <div className="n-text">{n.text}</div>
                </>
              )}
              {n.type === 'badge' && (
                <>
                  <div className="n-title">
                    Новое достижение · <span className="hl">{n.name}</span>
                  </div>
                  <div className="n-text">Бейдж получен 🎉</div>
                </>
              )}
              {n.type === 'beaten' && (
                <>
                  <div className="n-title">Твой рекорд побит</div>
                  <div className="n-text">
                    <b>{n.who}</b> обошёл тебя в «{n.name}»: <b>{fmtMetricValue(n.metric, n.value)}</b>
                    {` (твой ${fmtMetricValue(n.metric, n.myValue)})`}
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
