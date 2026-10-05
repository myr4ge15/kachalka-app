import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getNotifications, getSeenAt, markAllSeen } from '../db/notifications.js'
import { cmpIsoAsc } from '../lib/cmp.js'
import { fmtWhen } from '../lib/dates.js'
import { fmtMetricValue } from '../lib/metric.js'
import CardsSkeleton from '../components/CardsSkeleton.jsx'
import BackButton from '../components/BackButton.jsx'
import { getUsers } from '../db/repo.js'
import { byGender } from '../lib/gender.js'
import { filterNotifs, activeCategories } from '../lib/notifFilter.js'
import { plural } from '../lib/plural.js'

// Экран «Уведомления»: личные рекорды и кто обходит тебя в кругу (ТЗ §4.5, MVP).
// Вложенный роут — шапка с общей круглой BackButton, как у остальных вложенных
// экранов (РЕВЬЮ-КОДА-2026-10-02). onBack — вернуться туда, откуда открыли.
// onOpenFeedback(id) — ответ разработчика ведет на свое обращение (v6.12.0).
export default function NotificationsScreen({ user, onBack, onOpenFeedback }) {
  const list = useLiveQuery(() => getNotifications(user.id), [user.id], undefined)
  // Пол участников из ростера — род глаголов («оценила», «обошла», «дотянула»), v6.2.5.
  const roster = useLiveQuery(() => getUsers(), [], [])
  const sexOf = (id) => (roster ?? []).find((u) => u.id === id)?.sex ?? null
  const mySexNow = sexOf(user.id)
  const loading = list === undefined
  // useMemo, а не голое `list ?? []`: при загрузке (list===undefined) `?? []` давал
  // бы НОВЫЙ [] на каждый рендер → deps эффекта «пометить прочитанным» менялись бы
  // вхолостую. Мемо-обертка держит ссылку стабильной, пока list не приедет.
  const items = useMemo(() => list ?? [], [list])

  // Метка «было прочитано до открытия» фиксируется один раз на маунте — по ней
  // подсвечиваем непрочитанные. Затем двигаем метку вперед (бейдж гаснет).
  const seenRef = useRef('')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    getSeenAt(user.id).then((s) => {
      if (alive) {
        seenRef.current = s
        setReady(true)
      }
    }).catch(() => { if (alive) setReady(true) }) // без метки — просто без подсветки
    return () => { alive = false }
  }, [user.id])

  // Как только список и метка готовы — помечаем все прочитанным (один раз).
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
      <div className="admin-head">
        <BackButton onClick={onBack} />
        <h2 className="admin-title">Уведомления</h2>
      </div>
      <p className="muted sub">Твои рекорды, реакции друзей и кто обходит тебя в кругу</p>

      {loading && <CardsSkeleton cards={4} />}

      {!loading && items.length === 0 && (
        <p className="muted empty">Пока тихо. Новые рекорды появятся здесь 💪</p>
      )}

      {!loading && items.length > 0 && (
        <div className="muted notif-count">
          {unreadCount > 0 ? `${unreadCount} ${plural(unreadCount, 'новое', 'новых', 'новых')}` : 'все прочитано'}
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
          : n.type === 'feedback' ? '💬'
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
                    Ты {byGender(mySexNow, 'дотянул', 'дотянула')} до цели: <b>{fmtMetricValue(n.metric, n.value)}</b>
                  </div>
                </>
              )}
              {n.type === 'reaction' && (
                <>
                  <div className="n-title">
                    Реакция на тренировку · <span className="hl">{n.who}</span>
                  </div>
                  <div className="n-text">
                    {byGender(sexOf(n.whoId), 'Оценил', 'Оценила')} твою тренировку: <b>{(n.emojis ?? []).join(' ')}</b>
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
              {n.type === 'feedback' && (
                <>
                  <div className="n-title">
                    Ответ разработчика{n.status === 'resolved' ? ' · решено' : n.status === 'declined' ? ' · не будем делать' : ''}
                  </div>
                  <div className="n-text">
                    {n.text || (n.photos > 0 ? '📎 Ответ со скриншотом' : '')}
                  </div>
                  {onOpenFeedback && (
                    <button type="button" className="link-btn n-open" onClick={() => onOpenFeedback(n.feedbackId)}>
                      Открыть обращение ›
                    </button>
                  )}
                </>
              )}
              {n.type === 'beaten' && (
                <>
                  <div className="n-title">Твой рекорд побит</div>
                  <div className="n-text">
                    <b>{n.who}</b> {byGender(sexOf(n.whoId), 'обошел', 'обошла')} тебя в «{n.name}»: <b>{fmtMetricValue(n.metric, n.value)}</b>
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
