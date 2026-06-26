import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCachedLeaderboard, fetchLeaderboard } from '../db/leaderboard.js'
import { getUsers } from '../db/repo.js'
import { onOnline, onResume } from '../lib/appEvents.js'
import Avatar from './../components/Avatar.jsx'

// Медаль для тройки призёров, дальше — номер места.
function place(i) {
  return ['🥇', '🥈', '🥉'][i] ?? `${i + 1}`
}

// Лидерборд по жиму лёжа (ТЗ §4.3, §8.3 — MVP).
// Компактный рейтинг наверху социального экрана: место — по ФАКТИЧЕСКОМУ
// максимальному весу каждого участника, расчётный 1ПМ показан сноской («кто в
// теории может выжать больше»). Самодостаточен — сам тянет и кэширует данные.
export default function Leaderboard({ user }) {
  const board = useLiveQuery(() => getCachedLeaderboard(), [], undefined)
  const users = useLiveQuery(() => getUsers(), [], [])
  const avatarById = useMemo(() => {
    const m = new Map()
    for (const u of users ?? []) m.set(u.id, u.avatar_url)
    return m
  }, [users])
  const [error, setError] = useState(null)
  const loading = board === undefined
  const list = board ?? []

  // Обновляем при входе на экран и появлении сети. Ошибку НЕ глотаем молча:
  // логируем и кладём в state. Частая причина — не задеплоен RPC
  // `leaderboard_bench`; в этом случае рейтинг всё равно посчитается фолбэком из
  // кэша Ленты (см. getCachedLeaderboard), поэтому баннер показываем только когда
  // показать нечего (см. ниже). Подписки — через общий хаб (lib/appEvents.js).
  useEffect(() => {
    const refresh = () => {
      if (!navigator.onLine) return
      fetchLeaderboard()
        .then(() => setError(null))
        .catch((err) => {
          console.warn('Лидерборд: обновление с сервера не удалось', err)
          setError(err?.message ?? String(err))
        })
    }
    refresh()
    const off1 = onResume(refresh)
    const off2 = onOnline(refresh)
    return () => { off1(); off2() }
  }, [])

  // Пока читаем кэш — ничего не мигаем.
  if (loading) return null

  // Видимые состояния вместо молчаливого null (раньше пустой/ошибочный рейтинг
  // выглядел снаружи как «фичи нет»). Показываем компактную карточку-заглушку.
  if (list.length === 0) {
    return (
      <div className="card lb-card">
        <div className="lb-head">
          <h3 className="lb-title">🏋️ Лидерборд · жим лёжа</h3>
          <span className="muted lb-metric">факт, кг</span>
        </div>
        {error ? (
          <p className="muted lb-empty">Не удалось загрузить рейтинг. Проверь соединение и попробуй позже.</p>
        ) : (
          <p className="muted lb-empty">Пока нет данных по жиму — запиши подход в жиме лёжа.</p>
        )}
      </div>
    )
  }

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
              <Avatar name={row.user_name} url={avatarById.get(row.user_id)} className="avatar-sm" />
              <span className="lb-who">
                <span className="lb-name">{row.user_name}</span>
                {isMe && <span className="feed-me">ты</span>}
              </span>
              <span className="lb-fact">
                <span className="lb-weight">{row.weight} кг</span>
                <span className="lb-sub muted">{row.reps} повт · 1ПМ ~{row.orm}</span>
              </span>
            </li>
          )
        })}
      </ol>
      <p className="muted lb-note">
        Место — по фактическому весу. 1ПМ — расчётная оценка «на раз» (Эпли),
        всегда ≥ факта: видно, кто в теории может выжать больше.
      </p>
    </div>
  )
}
