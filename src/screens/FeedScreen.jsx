import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCachedFeed, fetchFeed } from '../db/feed.js'
import Leaderboard from './Leaderboard.jsx'

// «сегодня / вчера / дд.мм.гггг» + время
function fmtWhen(iso) {
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

function initial(name) {
  return (name ?? '?').trim().charAt(0).toUpperCase() || '?'
}

export default function FeedScreen({ user }) {
  // Кэш ленты (офлайн-доступен, обновляется мгновенно при фоновой подтяжке).
  const feed = useLiveQuery(() => getCachedFeed(), [], undefined)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const loading = feed === undefined
  const list = feed ?? []

  async function refresh() {
    if (!navigator.onLine) {
      setError(list.length ? null : 'Лента недоступна офлайн. Подключись к сети.')
      return
    }
    setRefreshing(true)
    setError(null)
    try {
      await fetchFeed()
    } catch (err) {
      setError('Не удалось обновить ленту: ' + (err?.message ?? err))
    } finally {
      setRefreshing(false)
    }
  }

  // Обновляем при входе на экран, возврате вкладки и появлении сети.
  useEffect(() => {
    refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="screen">
      <div className="feed-head">
        <h2 className="screen-title">Лента</h2>
        <button className="link-btn" onClick={refresh} disabled={refreshing}>
          {refreshing ? 'обновление…' : 'обновить'}
        </button>
      </div>
      <p className="muted sub">Последние тренировки друзей</p>

      <Leaderboard user={user} />

      {error && <div className="banner error">{error}</div>}

      {loading && <p className="muted">Загрузка…</p>}

      {!loading && list.length === 0 && !error && (
        <p className="muted empty">Пока никто ничего не записал. Будь первым 💪</p>
      )}

      {list.map((w) => {
        const isMe = w.user_id === user.id
        return (
          <div key={w.id} className="card feed-card">
            <div className="feed-card-head">
              <div className="avatar" aria-hidden>{initial(w.user_name)}</div>
              <div className="feed-who">
                <div className="feed-name">
                  {w.user_name}
                  {isMe && <span className="feed-me">ты</span>}
                </div>
                <div className="muted feed-when">{fmtWhen(w.performed_at)}</div>
              </div>
            </div>

            {w.prs?.length > 0 && (
              <div className="pr-row">
                {w.prs.map((pr, i) => (
                  <span key={i} className="pr-badge" title="Новый личный рекорд">
                    🏆 {pr.name} · {pr.orm} кг
                  </span>
                ))}
              </div>
            )}

            <ul className="history-list">
              {w.entries.map((e, i) => (
                <li key={i} className="history-ex">
                  <span className="history-ex-name">{e.name}</span>
                  <span className="history-ex-sets">
                    {e.sets.map((s) => `${s.weight}×${s.reps}`).join(', ') || '—'}
                  </span>
                </li>
              ))}
            </ul>

            <div className="muted feed-foot">
              {w.exCount} упр · {w.setCount} подх. · {w.tonnage.toLocaleString('ru-RU')} кг тоннаж
            </div>
          </div>
        )
      })}
    </div>
  )
}
