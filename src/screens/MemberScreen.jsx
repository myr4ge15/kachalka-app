import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCachedMember, fetchMember, toggleMemberReaction } from '../db/memberProfile.js'
import { syncNow } from '../db/sync.js'
import { vibrate, HAPTIC } from '../lib/haptics.js'
import { getCachedUser } from '../db/repo.js'
import { onOnline, onResume } from '../lib/appEvents.js'
import { buildMemberView, MEMBER_LIMIT } from '../lib/memberProfile.js'
import { fmtWhen } from '../lib/dates.js'
import { fmtSet, fmtMetricValue } from '../lib/metric.js'
import { plural } from '../lib/plural.js'
import AvatarZoom from '../components/AvatarZoom.jsx'
import BackButton from '../components/BackButton.jsx'
import CardsSkeleton from '../components/CardsSkeleton.jsx'
import FeedPrBadge from '../components/FeedPrBadge.jsx'
import ReactionBar from '../components/ReactionBar.jsx'
import './MemberScreen.css'

// Профиль другого участника (v6.7.0): статы, рекорды, любимое и последние
// тренировки. Только чтение — ни правок, ни целей, ни настроек. Данные — витрина
// db/memberProfile.js (read-only запрос под RLS + кэш в meta), расчеты — те же
// функции, что у своего Профиля (lib/memberProfile.js → lib/profileStats.js).
//
// Пропсы: user (кто смотрит), memberId, onBack().
const REC_PREVIEW = 5
const RECENT_STEP = 5

export default function MemberScreen({ user, memberId, onBack }) {
  const snap = useLiveQuery(
    () => getCachedMember(memberId, { id: user.id, name: user.name }),
    [memberId, user.id, user.name],
    undefined
  )
  const roster = useLiveQuery(() => getCachedUser(memberId), [memberId], undefined)

  const [refreshing, setRefreshing] = useState(false)
  const [fetched, setFetched] = useState(false)
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

  // Кнопка «наверх» (v6.7.1): профиль длинный, а «назад» и шапка — в самом верху.
  // Скроллится не экран, а общий .content (App.jsx).
  const rootRef = useRef(null)
  const [showTop, setShowTop] = useState(false)
  useEffect(() => {
    const sc = rootRef.current?.closest('.content')
    if (!sc) return undefined
    const onScroll = () => setShowTop(sc.scrollTop > 500)
    onScroll()
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => sc.removeEventListener('scroll', onScroll)
  }, [])
  const toTop = () => {
    const sc = rootRef.current?.closest('.content')
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    sc?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  }

  useEffect(() => {
    refresh()
    const off1 = onResume(refresh)
    const off2 = onOnline(refresh)
    return () => { off1(); off2() }
  }, [refresh])

  const view = useMemo(
    () => (snap ? buildMemberView(snap.items, { total: snap.total }) : null),
    [snap]
  )

  const name = roster?.name ?? snap?.items?.[0]?.user_name ?? 'Участник'
  const loading = snap === undefined || (!snap && refreshing)
  const empty = !loading && (!view || view.recent.length === 0)
  // Окно неполное, если снимок пришел из ленты (там максимум 50 строк на всех).
  const partial = snap?.source === 'feed'

  return (
    <div className="screen profile member" ref={rootRef}>
      <div className="admin-head">
        <BackButton onClick={onBack} />
        <h2 className="admin-title">Профиль</h2>
      </div>

      <div className="prof-head">
        <AvatarZoom name={name} url={roster?.avatar_url} className="avatar-lg" />
        <div className="prof-id">
          <div className="prof-name"><span className="txt">{name}</span></div>
          {view?.lastAt && (
            <div className="member-sub">последняя тренировка — {fmtWhen(view.lastAt)}</div>
          )}
        </div>
      </div>

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
                <span className="pr-count" aria-label={`${view.records.length} рекордов`}>
                  {view.records.length}
                </span>
              </div>
              <ul className="pr-list">
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
                      <span className="pr-toggle-arr" aria-hidden="true">{recExpanded ? '⌃' : '⌄'}</span>
                    </button>
                  </li>
                )}
              </ul>
              {(view.windowFull || partial) && (
                <p className="hint">
                  {partial
                    ? 'По тренировкам из ленты — полный профиль подтянется по сети.'
                    : `По последним ${MEMBER_LIMIT} тренировкам.`}
                </p>
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
                  {w.prs?.length > 0 && (
                    <div className="feed-prs">
                      {w.prs.map((pr) => <FeedPrBadge key={`${pr.name}-${pr.value}`} pr={pr} />)}
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
                    {w.exCount} упр. · {w.setCount} подх. · {(w.tonnage ?? 0).toLocaleString('ru-RU')} кг тоннаж
                  </div>
                  <ReactionBar
                    reactions={w.reactions}
                    myId={user.id}
                    isMe={w.user_id === user.id}
                    onReact={(kind, mine) => onReact(w.id, kind, mine)}
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

      {showTop && (
        <button type="button" className="member-top" onClick={toTop} aria-label="Наверх" title="Наверх">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5" /><path d="M6 11l6-6 6 6" />
          </svg>
        </button>
      )}
    </div>
  )
}
