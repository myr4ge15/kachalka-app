import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCachedFeed, fetchFeed } from '../db/feed.js'
import { getUsers, toggleReaction } from '../db/repo.js'
import { getMeta } from '../db/local.js'
import { syncNow } from '../db/sync.js'
import { onOnline, onResume, onReselect } from '../lib/appEvents.js'
import { fmtWhen, fmtAgo } from '../lib/dates.js'
import { fmtMetricValue, fmtSet } from '../lib/metric.js'
import { summarizeReactions, reactorLine } from '../lib/reactions.js'
import { vibrate, HAPTIC } from '../lib/haptics.js'
import { pullDistance, shouldTriggerRefresh, PULL_THRESHOLD } from '../lib/pullRefresh.js'
import Leaderboard from './Leaderboard.jsx'
import Avatar from '../components/Avatar.jsx'
import CardsSkeleton from '../components/CardsSkeleton.jsx'

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

  // Приватный пользователь (флаг кэшируется на pull в meta `priv_${id}`). Раньше
  // ему прятали ленту и лидерборд целиком. С v3.14.0 приватный видит УРЕЗАННУЮ
  // ленту — только «избранный круг» (принятые связи, connections.sql); RLS отдаёт
  // ему свои + связанных, поэтому обычный fetchFeed уже возвращает нужное. Скрываем
  // только лидерборд (в общий рейтинг приватный по-прежнему не входит).
  const myPrivate = useLiveQuery(() => getMeta(`priv_${user.id}`), [user.id], false)

  const loading = feed === undefined
  const list = feed ?? []

  // Тап по реакции: оптимистично (очередь + правка кэша ленты), затем отправка.
  const onReact = useCallback((workoutId, kind, mine) => {
    // Тактильный отклик на постановку реакции (не на снятие) — лёгкое касание.
    if (!mine) vibrate(HAPTIC.tap)
    toggleReaction({ userId: user.id, userName: myName, workoutId, kind, mine })
      .then(() => { if (navigator.onLine) syncNow(user.id) })
      .catch(() => { /* оптимистичная правка уже в кэше; синк догонит позже */ })
  }, [user.id, myName])

  // Свежий список держим в ref, чтобы стабильный refresh не ловил устаревшее
  // значение list из замыкания первого рендера.
  const listRef = useRef(list)
  listRef.current = list

  // Guard от setState после размонтирования: экран рвётся на смене вкладки
  // (key={tab} в App), а fetchFeed может дорезолвиться позже (как в Profile/Admin).
  const aliveRef = useRef(true)
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false } }, [])

  const refresh = useCallback(async () => {
    if (!navigator.onLine) {
      setError(listRef.current.length ? null : 'Лента недоступна офлайн. Подключись к сети.')
      return
    }
    setRefreshing(true)
    setError(null)
    try {
      await fetchFeed(user.id)
      if (!aliveRef.current) return
      setUpdatedAt(Date.now())
      setNowTick(Date.now())
    } catch (err) {
      if (aliveRef.current) setError('Не удалось обновить ленту: ' + (err?.message ?? err))
    } finally {
      if (aliveRef.current) setRefreshing(false)
    }
  }, [user.id])

  // Обновляем при входе на экран, возврате вкладки и появлении сети
  // (подписки — через общий хаб событий, см. lib/appEvents.js).
  useEffect(() => {
    refresh()
    const off1 = onResume(refresh)
    const off2 = onOnline(refresh)
    // Повторный тап по вкладке «Лента» → обновляем (как pull-to-refresh, но тапом).
    const off3 = onReselect((t) => { if (t === 'feed') refresh() })
    return () => { off1(); off2(); off3() }
  }, [refresh])

  // Pull-to-refresh: жест «потянуть вниз» у самого верха Ленты → тот же refresh.
  // Скроллится не сам экран, а родительский .content (см. App.jsx/index.css),
  // поэтому touch-слушатели вешаем на него. Чистая математика жеста (резина/порог)
  // — в lib/pullRefresh.js. Индикатор .ptr следует за пальцем, на отпускании
  // пружинит назад; при переходе порога — лёгкий haptic + обновление.
  const rootRef = useRef(null)
  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  // Индикатор крутится только для обновления, ЗАПУЩЕННОГО жестом (не для тихого
  // авто-refresh при входе на вкладку/возврате/сети — тот лениту не «дёргает»).
  const [ptrBusy, setPtrBusy] = useState(false)
  const pullRef = useRef(0)
  const refreshingRef = useRef(refreshing)
  refreshingRef.current = refreshing

  // Обновление завершилось — гасим спиннер жеста.
  useEffect(() => { if (!refreshing) setPtrBusy(false) }, [refreshing])

  useEffect(() => {
    const root = rootRef.current
    const sc = root?.closest('.content')
    if (!sc) return
    let startY = null
    let active = false
    const setPx = (v) => { pullRef.current = v; setPull(v) }

    const onStart = (e) => {
      // Начинаем следить за жестом только у самого верха и не во время обновления.
      startY = (!refreshingRef.current && sc.scrollTop <= 0) ? e.touches[0].clientY : null
      active = false
    }
    const onMove = (e) => {
      if (startY == null) return
      if (sc.scrollTop > 0) { startY = null; active = false; setDragging(false); setPx(0); return }
      const raw = e.touches[0].clientY - startY
      if (raw <= 0) { if (active) { active = false; setDragging(false); setPx(0) } return }
      if (!active) { active = true; setDragging(true) }
      // Забираем жест у нативного оверскролла, чтобы тянулся наш индикатор.
      e.preventDefault()
      setPx(pullDistance(raw))
    }
    const onEnd = () => {
      if (startY == null) return
      startY = null
      const triggered = active && shouldTriggerRefresh(pullRef.current) && !refreshingRef.current
      active = false
      setDragging(false)
      setPx(0)
      if (triggered) { vibrate(HAPTIC.tap); setPtrBusy(true); refresh() }
    }

    sc.addEventListener('touchstart', onStart, { passive: true })
    sc.addEventListener('touchmove', onMove, { passive: false })
    sc.addEventListener('touchend', onEnd)
    sc.addEventListener('touchcancel', onEnd)
    return () => {
      sc.removeEventListener('touchstart', onStart)
      sc.removeEventListener('touchmove', onMove)
      sc.removeEventListener('touchend', onEnd)
      sc.removeEventListener('touchcancel', onEnd)
    }
  }, [refresh])

  // Прогресс жеста 0..1 и позиция плавающего индикатора. Сам экран НЕ двигаем —
  // контент (заголовок, карточки) стоит на месте; сверху из-за края «выплывает»
  // компактный круглый бейдж (как нативный Material pull-to-refresh), а не весь
  // экран уезжает вниз, оголяя пустоту.
  const ptrProgress = Math.min(pull / PULL_THRESHOLD, 1)
  const ptrShown = ptrBusy || pull > 0
  const ptrY = ptrBusy ? 8 : -40 + ptrProgress * 48   // px: из-за края в зону видимости
  const ptrReady = ptrBusy || pull >= PULL_THRESHOLD

  return (
    <div className="screen feed-screen" ref={rootRef}>
      {/* Индикатор жеста «потянуть вниз»: компактный круглый бейдж, выплывает из-за
          верхнего края и доворачивает стрелку по мере протягивания; при достижении
          порога — «готов» (зелёный), во время обновления — крутится. Экран под ним
          неподвижен. */}
      {ptrShown && (
        <div
          className={'ptr' + (ptrReady ? ' ready' : '') + (ptrBusy ? ' loading' : '')}
          aria-hidden="true"
          style={{
            transform: `translate(-50%, ${ptrY}px)`,
            opacity: ptrBusy ? 1 : ptrProgress,
            transition: dragging ? 'none' : 'transform var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out)',
          }}
        >
          <span
            className="ptr-ico"
            style={!ptrBusy && pull ? { transform: `rotate(${ptrProgress * 180}deg)` } : undefined}
          >
            {ptrBusy ? '↻' : '↓'}
          </span>
        </div>
      )}
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
      <p className="muted sub">
        {myPrivate ? 'Приватный режим — только твой круг' : 'Последние тренировки друзей'}
      </p>

      {/* Приватному напоминаем, что лента ограничена кругом (его настраивает админ). */}
      {myPrivate && (
        <p className="muted sub">
          Тебе видны только те, кому админ открыл взаимный доступ.
        </p>
      )}

      {/* Десктоп (≥900px) раскладывает это в две колонки: посты слева, рейтинг
          в правом сайдбаре. На мобиле — один столбец, рейтинг сверху (.feed-rail
          order:-1), как было раньше. */}
      <div className="feed-layout">
        <div className="feed-main">
          {error && <div className="banner error">{error}</div>}

          {loading && <CardsSkeleton cards={3} height={120} />}

          {!loading && list.length === 0 && !error && (
            myPrivate ? (
              <p className="muted empty">
                Пока пусто. Тебе видны только те, кому админ открыл взаимный доступ —
                попроси админа добавить друзей в твой круг.
              </p>
            ) : (
              <p className="muted empty">Пока никто ничего не записал. Будь первым 💪</p>
            )
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
              <div className="feed-prs">
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

        {/* Лидерборд приватному не показываем: в общий рейтинг он не входит. */}
        {!myPrivate && (
          <aside className="feed-rail">
            <Leaderboard user={user} />
          </aside>
        )}
      </div>
    </div>
  )
}
