import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCachedLeaderboard, fetchLeaderboard } from '../db/leaderboard.js'

// Медаль для тройки призёров, дальше — номер места.
function place(i) {
  return ['🥇', '🥈', '🥉'][i] ?? `${i + 1}`
}

// Лидерборд по жиму лёжа (ТЗ §4.3, §8.3 — MVP).
// Компактный рейтинг наверху социального экрана: лучший расчётный 1ПМ каждого
// участника по всей истории. Самодостаточен — сам тянет и кэширует данные.
export default function Leaderboard({ user }) {
  const board = useLiveQuery(() => getCachedLeaderboard(), [], undefined)
  const loading = board === undefined
  const list = board ?? []

  // Тихо обновляем при входе на экран и появлении сети (ошибки не мешают ленте).
  useEffect(() => {
    const refresh = () => {
      if (navigator.onLine) fetchLeaderboard().catch(() => {})
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    refresh()
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (loading || list.length === 0) return null

  return (
    <div className="card lb-card">
      <div className="lb-head">
        <h3 className="lb-title">🏋️ Лидерборд · жим лёжа</h3>
        <span className="muted lb-metric">1ПМ</span>
      </div>
      <ol className="lb-list">
        {list.map((row, i) => {
          const isMe = row.user_id === user.id
          return (
            <li key={row.user_id} className={isMe ? 'lb-row me' : 'lb-row'}>
              <span className="lb-place">{place(i)}</span>
              <span className="lb-name">
                {row.user_name}
                {isMe && <span className="feed-me">ты</span>}
              </span>
              <span className="lb-set muted">{row.weight}×{row.reps}</span>
              <span className="lb-orm">{row.orm} кг</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
