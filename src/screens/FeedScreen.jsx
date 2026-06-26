import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCachedFeed, fetchFeed } from '../db/feed.js'
import { getUsers } from '../db/repo.js'
import { onOnline, onResume } from '../lib/appEvents.js'
import { fmtWhen } from '../lib/dates.js'
import { dayTags, tagSlug, matchesGroup, availableGroups } from '../lib/dayTags.js'
import Leaderboard from './Leaderboard.jsx'
import Avatar from '../components/Avatar.jsx'

export default function FeedScreen({ user }) {
  // Кэш ленты (офлайн-доступен, обновляется мгновенно при фоновой подтяжке).
  const feed = useLiveQuery(() => getCachedFeed(), [], undefined)

  // Аватары участников — из кэша пользователей (по user_id строки ленты).
  const users = useLiveQuery(() => getUsers(), [], [])
  const avatarById = useMemo(() => {
    const m = new Map()
    for (const u of users ?? []) m.set(u.id, u.avatar_url)
    return m
  }, [users])
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const loading = feed === undefined
  const list = feed ?? []

  // Фильтр по группе мышц (null = «Все»); чипы — только встречающиеся группы.
  const [filter, setFilter] = useState(null)
  const groups = useMemo(() => availableGroups(list), [list])
  const shown = useMemo(
    () => list.filter((w) => matchesGroup(w.entries, filter)),
    [list, filter]
  )

  // Свежий список держим в ref, чтобы стабильный refresh не ловил устаревшее
  // значение list из замыкания первого рендера.
  const listRef = useRef(list)
  listRef.current = list

  const refresh = useCallback(async () => {
    if (!navigator.onLine) {
      setError(listRef.current.length ? null : 'Лента недоступна офлайн. Подключись к сети.')
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
  }, [])

  // Обновляем при входе на экран, возврате вкладки и появлении сети
  // (подписки — через общий хаб событий, см. lib/appEvents.js).
  useEffect(() => {
    refresh()
    const off1 = onResume(refresh)
    const off2 = onOnline(refresh)
    return () => { off1(); off2() }
  }, [refresh])

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

      {groups.length > 0 && (
        <div className="chips tag-filter">
          <button
            className={filter === null ? 'chip active' : 'chip'}
            onClick={() => setFilter(null)}
          >
            Все
          </button>
          {groups.map((g) => (
            <button
              key={g}
              className={filter === g ? 'chip active' : 'chip'}
              onClick={() => setFilter(filter === g ? null : g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {!loading && list.length > 0 && shown.length === 0 && (
        <p className="muted empty">Нет тренировок с группой «{filter}».</p>
      )}

      {shown.map((w) => {
        const isMe = w.user_id === user.id
        const tags = dayTags(w.entries)
        return (
          <div key={w.id} className="card feed-card">
            <div className="feed-card-head">
              <Avatar name={w.user_name} url={avatarById.get(w.user_id)} className="avatar" />
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
                {w.prs.map((pr) => (
                  <span key={`${pr.name}-${pr.weight}`} className="pr-badge" title="Новый личный рекорд">
                    🏆 {pr.name} · {pr.weight} кг
                  </span>
                ))}
              </div>
            )}

            {tags.length > 0 && (
              <div className="day-tags">
                {tags.map((g) => (
                  <span key={g} className={`day-tag tag-${tagSlug(g)}`}>{g}</span>
                ))}
              </div>
            )}

            <ul className="history-list">
              {w.entries.map((e, i) => (
                <li key={e.exercise_id ?? e.name ?? i} className="history-ex">
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
