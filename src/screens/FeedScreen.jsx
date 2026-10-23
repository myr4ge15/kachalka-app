import Chevron from '../components/ui/Chevron.jsx'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRevealFocus } from '../hooks/useRevealFocus.js'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCachedFeed, fetchFeed } from '../db/feed.js'
import { getUsers, toggleReaction } from '../db/repo.js'
import { syncNow } from '../db/sync.js'
import { onOnline, onResume, onReselect } from '../lib/appEvents.js'
import { fmtWhen, fmtAgo } from '../lib/dates.js'
import SetsCells from '../components/workout/SetsCells.jsx'
import { vibrate, HAPTIC } from '../lib/haptics.js'
import { pullDistance, shouldTriggerRefresh, PULL_THRESHOLD } from '../lib/pullRefresh.js'
import Leaderboard from './Leaderboard.jsx'
import Avatar from '../components/ui/Avatar.jsx'
import CardsSkeleton from '../components/ui/CardsSkeleton.jsx'
import FeedPrBadge, { prForEntry } from '../components/social/FeedPrBadge.jsx'
import WorkoutSocial from '../components/social/WorkoutSocial.jsx'
import { useSpinPhase } from '../hooks/useSpinPhase.js'
import { usePresence } from '../hooks/usePresence.js'
import { isOnline } from '../lib/presence.js'
import EmptyHint from '../components/ui/EmptyHint.jsx'

// Рейтинг над постами на телефоне — свернут по умолчанию (v6.11.1): раньше он
// всегда стоял раскрытым и отодвигал саму ленту. Выбор помним на устройстве для
// каждой учетки. На десктопе рейтинг — сайдбар, там он всегда виден (CSS).
const railKey = (userId) => `gym_app_feed_rating_open_${userId}`
function readRailOpen(userId) {
  try { return localStorage.getItem(railKey(userId)) === '1' } catch { return false }
}
function writeRailOpen(userId, open) {
  try { localStorage.setItem(railKey(userId), open ? '1' : '0') } catch { /* приватный режим */ }
}

// flashId — id тренировки, к которой привел пуш о реакции (v6.7.3): ее карточка
// коротко подсвечивается акцентом, чтобы было видно, какую оценили.
const OFFLINE_EMPTY = 'Лента недоступна офлайн. Подключись к сети.'

// threadId — тренировка, к которой привел пуш о комментарии (19.10.2026): ее ветка раскрыта.
export default function FeedScreen({ user, onOpenMember, flashId = null, threadId = null, onOpenCircle, onOpenFriends }) {
  // Кэш ленты (офлайн-доступен, обновляется мгновенно при фоновой подтяжке).
  const feed = useLiveQuery(() => getCachedFeed(), [], undefined)

  // Аватары участников — из кэша пользователей (по user_id строки ленты).
  const users = useLiveQuery(() => getUsers(), [], [])
  const avatarById = useMemo(() => {
    const m = new Map()
    for (const u of users ?? []) m.set(u.id, u.avatar_url)
    return m
  }, [users])
  // «В сети» (v8.6.0) — точка на аватарке автора карточки.
  const presence = usePresence(user.id)
  // Свое имя (для оптимистичной строки реакций). Из ростра, фолбэк — user.name.
  const myName = useMemo(
    () => (users ?? []).find((u) => u.id === user.id)?.name ?? user.name ?? 'Ты',
    [users, user.id, user.name]
  )
  const me = useMemo(
    () => ({ id: user.id, name: myName, avatar: avatarById.get(user.id) ?? null }),
    [user.id, myName, avatarById]
  )
  const [refreshing, setRefreshing] = useState(false)
  const spinStyle = useSpinPhase(refreshing) // стрелка в такт синку в шапке (v6.3.6)
  const [error, setError] = useState(null)
  // Когда лента последний раз успешно обновлялась (мс) + тикающее «сейчас», чтобы
  // метка «обновлено N назад» освежалась без действий пользователя.
  const [updatedAt, setUpdatedAt] = useState(null)
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const loading = feed === undefined
  const list = feed ?? []

  const [railOpen, setRailOpen] = useState(() => readRailOpen(user.id))
  // Рейтинг, раскрытый тапом, — в видимую область (v8.0.1); сохраненное раскрытие при входе — нет.
  const [railReveal, setRailReveal] = useState(null)
  const railRef = useRevealFocus(railReveal, { block: 'nearest' })
  const toggleRail = () => {
    setRailReveal(railOpen ? null : {})
    setRailOpen((open) => { writeRailOpen(user.id, !open); return !open })
  }

  // Тап по реакции: оптимистично (очередь + правка кэша ленты), затем отправка.
  const onReact = useCallback((workoutId, kind, mine) => {
    // Тактильный отклик на постановку реакции (не на снятие) — легкое касание.
    if (!mine) vibrate(HAPTIC.tap)
    toggleReaction({ userId: user.id, userName: myName, workoutId, kind, mine })
      .then(() => { if (navigator.onLine) syncNow(user.id) })
      .catch(() => { /* оптимистичная правка уже в кэше; синк догонит позже */ })
  }, [user.id, myName])

  // Свежий список держим в ref, чтобы стабильный refresh не ловил устаревшее
  // значение list из замыкания первого рендера.
  const listRef = useRef(list)
  listRef.current = list

  // Guard от setState после размонтирования: экран рвется на смене вкладки
  // (key={tab} в App), а fetchFeed может дорезолвиться позже (как в Profile/Admin).
  const aliveRef = useRef(true)
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false } }, [])

  const refresh = useCallback(async () => {
    if (!navigator.onLine) {
      setError(OFFLINE_EMPTY)
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
  // пружинит назад; при переходе порога — легкий haptic + обновление.
  const rootRef = useRef(null)
  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  // Индикатор крутится только для обновления, ЗАПУЩЕННОГО жестом (не для тихого
  // авто-refresh при входе на вкладку/возврате/сети — тот лениту не «дергает»).
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
    let startX = null
    let active = false
    const setPx = (v) => { pullRef.current = v; setPull(v) }

    const onStart = (e) => {
      // .content общий: под вложенным экраном (профиль участника, «Мой круг», «Друзья») слой
      // Ленты жив, но inert — жест там не наш (UI-ревью 23.10).
      if (root.closest('[inert]')) { startY = null; return }
      // Начинаем следить за жестом только у самого верха и не во время обновления.
      startY = (!refreshingRef.current && sc.scrollTop <= 0) ? e.touches[0].clientY : null
      startX = e.touches[0].clientX ?? 0
      active = false
    }
    const onMove = (e) => {
      if (startY == null) return
      if (sc.scrollTop > 0) { startY = null; active = false; setDragging(false); setPx(0); return }
      const raw = e.touches[0].clientY - startY
      if (!active) {
        const dx = (e.touches[0].clientX ?? 0) - startX
        if (Math.max(Math.abs(dx), Math.abs(raw)) < 4) return
        // Горизонтальная прокрутка не должна запускать обновление Ленты.
        if (Math.abs(dx) > Math.abs(raw)) { startY = null; return }
      }
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
          порога — «готов» (зеленый), во время обновления — крутится. Экран под ним
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
            {/* SVG, а не текстовые ↻/↓: у глифов своя базовая линия, при вращении они «гуляли» (UI-ревью 23.10). */}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {ptrBusy
                ? <><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></>
                : <><path d="M12 5v14" /><path d="m6 13 6 6 6-6" /></>}
            </svg>
          </span>
        </div>
      )}
      <div className="feed-head">
        <h2 className="screen-title">Лента</h2>
        {/* v6.2.2: только иконка — большая «таблетка» с текстом спорила с заголовком.
            Свежесть («обновлено 5 мин назад») переехала в подзаголовок. */}
        {/* Свежесть — рядом с кнопкой, а не в подзаголовке (v6.3.3): при смене
            «обновляется…» ↔ «обновлено только что» текст подзаголовка перескакивал.
            Здесь он прижат вправо к кнопке и меняется на месте. */}
        {(refreshing || updatedAt) && (
          <span className="feed-fresh">
            {refreshing ? 'обновляется…' : `обновлено ${fmtAgo(updatedAt, nowTick)}`}
          </span>
        )}
        <button
          className="feed-refresh"
          onClick={refresh}
          disabled={refreshing}
          aria-label={refreshing ? 'Обновляется' : 'Обновить ленту'}
          title="Обновить ленту"
        >
          <svg className={refreshing ? 'feed-refresh-ico spin' : 'feed-refresh-ico'} style={spinStyle} viewBox="0 0 24 24" width="20" height="20"
            fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" />
          </svg>
        </button>
      </div>
      {/* v9.0.0: видимость у всех одна — друзья и участники кругов («Друзья», этап 2);
          «приватного режима с доступом от админа» в Ленте больше нет. */}
      <p className="muted sub">Тренировки друзей и участников твоих кругов</p>

      {/* Десктоп (≥900px) раскладывает это в две колонки: посты слева, рейтинг
          в правом сайдбаре. На мобиле — один столбец, рейтинг сверху (.feed-rail
          order:-1), как было раньше. */}
      <div className="feed-layout">
        <div className="feed-main">
          {/* «Офлайн» — только пока показать нечего: при запуске кэш еще не прочитан (список
              пуст), и плашка оставалась висеть над подгрузившимися карточками. */}
          {error && !(error === OFFLINE_EMPTY && list.length) && <div className="banner error">{error}</div>}

          {loading && <CardsSkeleton cards={3} height={120} />}

          {!loading && list.length === 0 && !error && (
            <>
              <EmptyHint emoji="👥" title="Лента друзей">
                Здесь появляются тренировки друзей и участников твоих кругов — на них можно ставить
                реакции. Пока пусто: добавь друзей или вступи в круг.
              </EmptyHint>
              <div className="fc-actions feed-empty-acts">
                {onOpenFriends && <button type="button" className="btn primary" onClick={onOpenFriends}>Друзья</button>}
                {onOpenCircle && <button type="button" className="btn ghost" onClick={onOpenCircle}>Мой круг</button>}
              </div>
            </>
          )}

          {list.map((w) => {
        const isMe = w.user_id === user.id
        return (
          <div key={w.id} className={`card feed-card${w.id === flashId ? ' feed-card--flash' : ''}`}>
            {/* Тап по автору — его профиль (v6.7.0; свой — обычный Профиль). */}
            <button
              type="button"
              className="feed-card-head feed-card-head-btn"
              data-anchor={`feed-${w.id}`}
              onClick={() => onOpenMember?.(w.user_id, `feed-${w.id}`)}
              aria-label={isMe ? 'Открыть мой профиль' : `Открыть профиль: ${w.user_name}`}
            >
              <Avatar name={w.user_name} url={avatarById.get(w.user_id)} className="avatar"
                online={!isMe && isOnline(presence.get(w.user_id))} />
              <div className="feed-who">
                <div className="feed-name">
                  {w.user_name}
                  {isMe && <span className="feed-me">я</span>}
                </div>
                <div className="muted feed-when">{fmtWhen(w.performed_at)}</div>
              </div>
              {/* Шеврон — подсказка, что шапка ведет в профиль (v6.7.1). */}
              {onOpenMember && (
                <Chevron className="go-chev" />
              )}
            </button>

            <ul className="history-list">
              {w.entries.map((e, i) => (
                <li key={e.exercise_id ?? e.name ?? i} className="history-ex">
                  <span className="history-ex-name">{e.name}{prForEntry(w, e) && <> <FeedPrBadge pr={prForEntry(w, e)} /></>}</span>
                  <span className="history-ex-sets">
                    <SetsCells metric={e.metric} sets={e.sets} />
                  </span>
                </li>
              ))}
            </ul>

            <div className="muted feed-foot">
              {/* Тоннаж — только если он есть: у тренировки из одних подтягиваний/планки
                  «0 кг тоннаж» выглядит как ошибка (v7.2.1). */}
              {w.exCount} упр. · {w.setCount} подх.{w.tonnage > 0 ? ` · ${w.tonnage.toLocaleString('ru-RU')} кг тоннаж` : ''}
            </div>

            <WorkoutSocial
              key={w.id === threadId ? `${w.id}-thread` : w.id}
              workout={w}
              me={me}
              isMe={isMe}
              authorAvatar={avatarById.get(w.user_id) ?? null}
              onReact={(kind, mine) => onReact(w.id, kind, mine)}
              onOpenMember={onOpenMember ? (uid) => onOpenMember(uid, `feed-${w.id}`) : undefined}
              openThread={w.id === threadId}
            />
          </div>
        )
          })}
        </div>

        {/* Рейтинг: общий — не приватным, доски кругов — участникам кругов, приватному без
            круга — подсказка «Мой круг» (DisciplineLeaderboard, «Мой круг» 07.10.2026). */}
        <aside ref={railRef} className="feed-rail" data-open={railOpen ? '1' : '0'}>
            {/* v6.12.0: строка-кнопка как «Настройки»/«Пригласить» в Профиле — мелкий
                серый заголовок с треугольником было еле видно. */}
            <button type="button" className="settings-toggle feed-rail-toggle" aria-expanded={railOpen}
              onClick={toggleRail}>
              <span className="settings-title"><span aria-hidden="true">🏆</span> Рейтинг</span>
              <Chevron className="settings-chev" open={railOpen} />
            </button>
            {/* Свернутый рейтинг не размонтируем: данные уже подгружены, раскрытие
                мгновенное, а на десктопе он виден всегда. */}
            <div className="feed-rail-body">
              <Leaderboard user={user} onOpenMember={onOpenMember} onOpenCircle={onOpenCircle} />
            </div>
        </aside>
      </div>
    </div>
  )
}
