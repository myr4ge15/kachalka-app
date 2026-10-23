import PhaseTag from '../components/workout/PhaseTag.jsx'
import Chevron from '../components/ui/Chevron.jsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCachedMember, fetchMember, toggleMemberReaction } from '../db/memberProfile.js'
import { syncNow } from '../db/sync.js'
import { vibrate, HAPTIC } from '../lib/haptics.js'
import { getCachedUser } from '../db/repo.js'
import { onOnline, onResume } from '../lib/appEvents.js'
import { buildMemberView, memberDisplay, MEMBER_GRACE_MS, MEMBER_LIMIT } from '../lib/memberProfile.js'
import { fmtWhen } from '../lib/dates.js'
import { isOnline, presenceLabel } from '../lib/presence.js'
import { usePresence } from '../hooks/usePresence.js'
import { fmtMetricValue } from '../lib/metric.js'
import SetsCells from '../components/workout/SetsCells.jsx'
import { plural, pluralize } from '../lib/plural.js'
import AvatarZoom from '../components/ui/AvatarZoom.jsx'
import BackButton from '../components/ui/BackButton.jsx'
import CardsSkeleton from '../components/ui/CardsSkeleton.jsx'
import FeedPrBadge, { prForEntry } from '../components/social/FeedPrBadge.jsx'
import WorkoutSocial from '../components/social/WorkoutSocial.jsx'
import FriendButton from '../components/friends/FriendButton.jsx'
import './MemberScreen.css'
import ScrollTopButton from '../components/ui/ScrollTopButton.jsx'

// Профиль другого участника (v6.7.0): статы, рекорды, любимое и последние
// тренировки. Только чтение — ни правок, ни целей, ни настроек. Данные — витрина
// db/memberProfile.js (read-only запрос под RLS + кэш в meta), расчеты — те же
// функции, что у своего Профиля (lib/memberProfile.js → lib/profileStats.js).
//
// Пропсы: user (кто смотрит), memberId, onBack(), onOpenMember(id) — профиль автора комментария (UI-ревью 23.10).
const REC_PREVIEW = 5
const RECENT_STEP = 5

export default function MemberScreen({ user, memberId, onBack, onOpenMember }) {
  const snap = useLiveQuery(
    () => getCachedMember(memberId, { id: user.id, name: user.name }),
    [memberId, user.id, user.name],
    undefined
  )
  const roster = useLiveQuery(() => getCachedUser(memberId), [memberId], undefined)
  // «В сети» / «был(а) …» (v8.6.0, обращения fb_34573163 и fb_d3fe3a5c).
  const lastSeen = usePresence(user.id).get(memberId) ?? null
  const seenLabel = memberId === user.id ? null : presenceLabel(lastSeen, { sex: roster?.sex ?? null })

  // Сразу «грузится», если есть сеть: refresh стартует в эффекте после первого кадра,
  // и без этого снимок из Ленты успевал мелькнуть до заглушки.
  const [refreshing, setRefreshing] = useState(() => navigator.onLine)
  const [fetched, setFetched] = useState(false)
  // Окно ожидания полного профиля (memberDisplay): до него снимок из Ленты не
  // показываем, чтобы цифры и рекорды не «прыгали» на глазах.
  const [graceOver, setGraceOver] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setGraceOver(true), MEMBER_GRACE_MS)
    return () => clearTimeout(t)
  }, [memberId])
  const [error, setError] = useState(null)
  const [recExpanded, setRecExpanded] = useState(false)
  const [shown, setShown] = useState(RECENT_STEP)

  const aliveRef = useRef(true)
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false } }, [])

  const refresh = useCallback(async () => {
    if (!navigator.onLine) return
    setRefreshing(true)
    setError(null)
    try {
      await fetchMember(user.id, memberId)
      if (aliveRef.current) setFetched(true)
    } catch (err) {
      if (aliveRef.current) setError('Не удалось обновить профиль: ' + (err?.message ?? err))
    } finally {
      if (aliveRef.current) setRefreshing(false)
    }
  }, [user.id, memberId])

  // Реакция на тренировку участника (v6.7.1): очередь + оптимистичная правка,
  // затем отправка и свежий снимок профиля.
  const onReact = useCallback((workoutId, kind, mine) => {
    if (!mine) vibrate(HAPTIC.tap)
    toggleMemberReaction({ userId: user.id, userName: user.name, memberId, workoutId, kind, mine })
      .then(async () => {
        if (!navigator.onLine) return
        await syncNow(user.id)
        if (aliveRef.current) await fetchMember(user.id, memberId)
      })
      .catch(() => { /* правка уже в кэше; синк догонит позже */ })
  }, [user.id, user.name, memberId])

  useEffect(() => {
    refresh()
    const off1 = onResume(refresh)
    const off2 = onOnline(refresh)
    return () => { off1(); off2() }
  }, [refresh])

  // Я — для оптимистичной строки комментария (19.10.2026).
  const me = useMemo(() => ({ id: user.id, name: user.name, avatar: null }), [user.id, user.name])
  const view = useMemo(
    () => (snap ? buildMemberView(snap.items, { total: snap.total }) : null),
    [snap]
  )

  const name = roster?.name ?? snap?.items?.[0]?.user_name ?? 'Участник'
  // Снимок из ленты неполный (там максимум 50 строк на всех): пока идет запрос и не
  // вышло время — заглушка, дальше — с пометками (memberDisplay, v7.2.3).
  const disp = memberDisplay({
    snapSource: snap === undefined ? undefined : snap?.source ?? null,
    refreshing, online: navigator.onLine, graceOver,
  })
  const loading = disp.skeleton
  const empty = !loading && (!view || view.recent.length === 0)
  const partial = disp.partial

  return (
    <div className="screen profile member">
      <div className="admin-head">
        <BackButton onClick={onBack} />
        <h2 className="admin-title">Профиль</h2>
      </div>

      <div className="prof-head">
        <AvatarZoom name={name} url={roster?.avatar_url} className="avatar-lg"
          online={memberId !== user.id && isOnline(lastSeen)} />
        <div className="prof-id">
          <div className="prof-name"><span className="txt">{name}</span></div>
          {seenLabel && (
            <div className={'member-sub' + (seenLabel === 'в сети' ? ' member-seen' : '')}>{seenLabel}</div>
          )}
          {view?.lastAt && (
            <div className="member-sub">последняя тренировка — {fmtWhen(view.lastAt)}</div>
          )}
          <FriendButton me={user.id} memberId={memberId} label />
        </div>
      </div>
      <FriendButton me={user.id} memberId={memberId} />

      {error && <div className="banner error">{error}</div>}
      {loading && <CardsSkeleton cards={3} />}

      {empty && (fetched || !navigator.onLine) && (
        <p className="muted empty">
          {navigator.onLine
            ? 'Тренировок пока не видно: участник еще ничего не записал или скрыл профиль.'
            : 'Профиль откроется, когда появится сеть.'}
        </p>
      )}

      {!loading && view && view.recent.length > 0 && (
        <>
          {partial && (
            <p className="member-partial" role="status">
              {disp.waiting
                ? 'Загружаю полный профиль… Пока — по тренировкам из Ленты, цифры неполные.'
                : 'Полный профиль не загрузился — показано по тренировкам из Ленты, цифры и рекорды неполные.'}
            </p>
          )}
          <div className="stat-grid member-stats">
            <div className="stat-cell">
              <div className="stat-num">{partial ? `${view.total}+` : view.total}</div>
              <div className="stat-lab">{plural(view.total, 'тренировка', 'тренировки', 'тренировок')}<br />всего</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num">{view.thisMonth}</div>
              <div className="stat-lab">в этом<br />месяце</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num">
                {view.streak}{(view.streakFloor || (partial && view.streak > 0)) && '+'}
              </div>
              <div className="stat-lab">{plural(view.streak, 'неделя', 'недели', 'недель')}<br />подряд</div>
            </div>
          </div>

          {view.records.length > 0 && (
            <section className="sec">
              <div className="pr-head">
                <p className="sec-title">Рекорды</p>
                <span className="pr-count" aria-label={pluralize(view.records.length, 'рекорд', 'рекорда', 'рекордов')}>
                  {view.records.length}
                </span>
              </div>
              <ul className={`pr-list${partial ? ' member-pr-partial' : ''}`}>
                {(recExpanded ? view.records : view.records.slice(0, REC_PREVIEW)).map((r) => (
                  <li key={r.exId}>
                    <div className="pr-row member-pr">
                      <span className="pr-name">
                        <span className="star-slot" aria-hidden="true">
                          {r.isBench && <span className="star" title="Упражнение рейтинга">🏅</span>}
                        </span>
                        <span className="txt">{r.name}</span>
                      </span>
                      <span className="pr-val">{fmtMetricValue(r.metric, r.value)}</span>
                    </div>
                  </li>
                ))}
                {view.records.length > REC_PREVIEW && (
                  <li className="pr-more">
                    <button
                      className="pr-toggle"
                      type="button"
                      aria-expanded={recExpanded}
                      onClick={() => setRecExpanded((v) => !v)}
                    >
                      <span>{recExpanded ? 'Свернуть' : `Показать все ${view.records.length}`}</span>
                      <span className="pr-toggle-arr" aria-hidden="true"><Chevron toggle open={recExpanded} size={16} /></span>
                    </button>
                  </li>
                )}
              </ul>
              {/* Неполный снимок объясняет плашка над цифрами (v7.2.3), здесь — только окно. */}
              {view.windowFull && !partial && (
                <p className="hint">По последним {MEMBER_LIMIT} тренировкам.</p>
              )}
            </section>
          )}

          {view.fav && (
            <section className="sec">
              <p className="sec-title">Любимое</p>
              <div className="info-row">
                <span className="em" aria-hidden="true">🔁</span>
                <div>
                  <div className="v">{view.fav.name}</div>
                  <div className="k">чаще всего · {view.fav.sets} {plural(view.fav.sets, 'подход', 'подхода', 'подходов')}</div>
                </div>
              </div>
            </section>
          )}

          <section className="sec">
            <p className="sec-title">Последние тренировки</p>
            <div className="member-list">
              {view.recent.slice(0, shown).map((w) => (
                <article key={w.id} className="card feed-card member-card">
                  <div className="member-card-when">{fmtWhen(w.performed_at)}</div>
                  <ul className="history-list">
                    {w.entries.map((e, i) => (
                      <li key={e.exercise_id ?? e.name ?? i} className="history-ex">
                        <span className="history-ex-name"><PhaseTag entry={e} />{e.name}{prForEntry(w, e) && <> <FeedPrBadge pr={prForEntry(w, e)} /></>}</span>
                        <span className="history-ex-sets">
                          <SetsCells metric={e.metric} sets={e.sets} />
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="muted feed-foot">
                    {w.exCount} упр. · {w.setCount} подх. · {(w.tonnage ?? 0).toLocaleString('ru-RU')} кг тоннаж
                  </div>
                  <WorkoutSocial
                    workout={w}
                    me={me}
                    isMe={w.user_id === user.id}
                    authorAvatar={roster?.avatar_url ?? null}
                    onReact={(kind, mine) => onReact(w.id, kind, mine)}
                    onOpenMember={onOpenMember}
                  />
                </article>
              ))}
            </div>
            {view.recent.length > shown && (
              <button className="btn ghost member-more" type="button" onClick={() => setShown((n) => n + RECENT_STEP)}>
                Показать еще
              </button>
            )}
          </section>
        </>
      )}

      {/* Кнопка «наверх» (v6.7.1): профиль длинный, а «назад» и шапка — в самом верху. */}
      <ScrollTopButton />
    </div>
  )
}
