import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCachedFeed, fetchFeed } from '../db/feed.js'
import { getUsers, toggleReaction } from '../db/repo.js'
import { getMeta } from '../db/local.js'
import { syncNow } from '../db/sync.js'
import { onOnline, onResume } from '../lib/appEvents.js'
import { fmtWhen, fmtAgo } from '../lib/dates.js'
import { fmtMetricValue, fmtSet } from '../lib/metric.js'
import { summarizeReactions, reactorLine } from '../lib/reactions.js'
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
  // Своё имя (для оптимистичной строки реакций). Из ростра, фолбэк — user.name.
  const myName = useMemo(
    () => (users ?? []).find((u) => u.id === user.id)?.name ?? user.name ?? 'Ты',
    [users, user.id, user.name]
  )
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  // Когда лента последний раз успешно обновлялась (мс) + тикающее «сейчас», чтобы
  // метка «обновлено N назад» освежалась без действий пользователя.
  const [updatedAt, setUpdatedAt] = useState(null)
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Приватный пользователь не участвует в социалке: ленту друзей и лидерборд ему
  // не показываем (свои тренировки — во вкладке «Мои тренировки»). Флаг кэшируется
  // на pull в meta `priv_${id}` (sync.js / my_is_private). Держим в ref, чтобы
  // refresh не тянул чужие данные.
  const myPrivate = useLiveQuery(() => getMeta(`priv_${user.id}`), [user.id], false)
  const privRef = useRef(false)
  privRef.current = myPrivate

  const loading = feed === undefined
  const list = feed ?? []

  // Тап по реакции: оптимистично (очередь + правка кэша ленты), затем отправка.
  const onReact = useCallback((workoutId, kind, mine) => {
    toggleReaction({ userId: user.id, userName: myName, workoutId, kind, mine })
      .then(() => { if (navigator.onLine) syncNow(user.id) })
      .catch(() => { /* оптимистичная правка уже в кэше; синк догонит позже */ })
  }, [user.id, myName])

  // Свежий список держим в ref, чтобы стабильный refresh не ловил устаревшее
  // значение list из замыкания первого рендера.
  const listRef = useRef(list)
  listRef.current = list

  const refresh = useCallback(async () => {
    if (privRef.current) return // приватному ленту не подтягиваем вовсе
    if (!navigator.onLine) {
      setError(listRef.current.length ? null : 'Лента недоступна офлайн. Подключись к сети.')
      return
    }
    setRefreshing(true)
    setError(null)
    try {
      await fetchFeed(user.id)
      setUpdatedAt(Date.now())
      setNowTick(Date.now())
    } catch (err) {
      setError('Не удалось обновить ленту: ' + (err?.message ?? err))
    } finally {
      setRefreshing(false)
    }
  }, [user.id])

  // Обновляем при входе на экран, возврате вкладки и появлении сети
  // (подписки — через общий хаб событий, см. lib/appEvents.js).
  useEffect(() => {
    refresh()
    const off1 = onResume(refresh)
    const off2 = onOnline(refresh)
    return () => { off1(); off2() }
  }, [refresh])

  // Приватный режим: лента друзей и лидерборд скрыты целиком.
  if (myPrivate) {
    return (
      <div className="screen">
        <div className="feed-head">
          <h2 className="screen-title">Лента</h2>
        </div>
        <p className="muted empty">
          Приватный режим включён — лента и рейтинг скрыты. Свои тренировки смотри
          во вкладке «Мои тренировки».
        </p>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="feed-head">
        <h2 className="screen-title">Лента</h2>
        <button className="link-btn feed-refresh" onClick={refresh} disabled={refreshing} title="Обновить">
          {refreshing
            ? '↻ обновление…'
            : updatedAt
              ? `↻ обновлено ${fmtAgo(updatedAt, nowTick)}`
              : '↻ обновить'}
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
                  <span key={`${pr.name}-${pr.value}`} className="pr-badge" title="Новый личный рекорд">
                    🏆 {pr.name} · {fmtMetricValue(pr.metric, pr.value)}
                  </span>
                ))}
              </div>
            )}

            <ul className="history-list">
              {w.entries.map((e, i) => (
                <li key={e.exercise_id ?? e.name ?? i} className="history-ex">
                  <span className="history-ex-name">{e.name}</span>
                  <span className="history-ex-sets">
                    {e.sets.map((s) => fmtSet(e.metric, s)).join(', ') || '—'}
                  </span>
                </li>
              ))}
            </ul>

            <div className="muted feed-foot">
              {w.exCount} упр · {w.setCount} подх. · {w.tonnage.toLocaleString('ru-RU')} кг тоннаж
            </div>

            {(() => {
              const { kinds, names, total } = summarizeReactions(w.reactions, user.id)
              const line = reactorLine(names)
              // Своя тренировка — самолайк запрещён: показываем только СВОДКУ
              // реакций других (статичные чипы + имена), без кнопок. Нет реакций
              // — не рендерим блок вовсе.
              if (isMe) {
                if (total === 0) return null
                return (
                  <div className="reactions">
                    <div className="reaction-btns">
                      {kinds.filter((k) => k.count > 0).map((k) => (
                        <span key={k.kind} className="reaction-btn static">
                          <span className="reaction-emoji">{k.emoji}</span>
                          <span className="reaction-count">{k.count}</span>
                        </span>
                      ))}
                    </div>
                    {line && <div className="muted reaction-who">{line}</div>}
                  </div>
                )
              }
              return (
                <div className="reactions">
                  <div className="reaction-btns">
                    {kinds.map((k) => (
                      <button
                        key={k.kind}
                        className={`reaction-btn${k.mine ? ' mine' : ''}`}
                        onClick={() => onReact(w.id, k.kind, k.mine)}
                        aria-pressed={k.mine}
                        title={k.mine ? 'Убрать реакцию' : 'Поставить реакцию'}
                      >
                        <span className="reaction-emoji">{k.emoji}</span>
                        {k.count > 0 && <span className="reaction-count">{k.count}</span>}
                      </button>
                    ))}
                  </div>
                  {line && <div className="muted reaction-who">{line}</div>}
                </div>
              )
            })()}
          </div>
        )
      })}
    </div>
  )
}
