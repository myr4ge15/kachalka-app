import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getBadgesView, backfillBadges } from '../db/badges.js'
import { fmtBadgeValue } from '../lib/badges.js'
import { fmtWhen } from '../lib/dates.js'
import CardsSkeleton from '../components/CardsSkeleton.jsx'

// Экран «Достижения» (PLAN-badges, Slice 1b). Сетка бейджей по категориям:
// полученные — с датой, закрытые — с прогресс-баром до вехи. Всё считается на
// клиенте из локальных тренировок (db/badges.js → lib/badges.js), живо
// обновляется через useLiveQuery. Схему/синк не трогаем.
//
// Пропсы: user, onBack().
export default function AchievementsScreen({ user, onBack }) {
  // Первый заход — тихо размечаем исторические вехи (без тостов/колокольчика),
  // чтобы у уже заслуженных бейджей появилась дата и держалась необратимость.
  useEffect(() => { backfillBadges(user.id) }, [user.id])

  const data = useLiveQuery(() => getBadgesView(user.id), [user.id])
  const loading = data === undefined
  const pct = data && data.total > 0 ? Math.round((data.earnedCount / data.total) * 100) : 0

  return (
    <div className="screen ach-screen">
      <div className="admin-head">
        <button className="admin-back" onClick={onBack}>‹ Назад</button>
        <h2 className="admin-title">Достижения</h2>
      </div>

      {loading ? (
        <CardsSkeleton cards={4} />
      ) : (
        <>
          <div className="ach-hero">
            <div className="ach-hero-top">
              <div className="ach-big">{data.earnedCount} <span>из {data.total}</span></div>
              <div className="ach-pct">{pct}%</div>
            </div>
            <div className="ach-bar"><i style={{ width: `${pct}%` }} /></div>
            {data.next && (
              <div className="ach-hero-sub">
                До «{data.next.def.icon} {data.next.def.name}» — ещё{' '}
                {fmtBadgeValue(data.next.def, data.next.remaining)}
              </div>
            )}
          </div>

          {data.cats.map((c) => (
            <section className="sec" key={c.cat}>
              <div className="ach-sec-head">
                <span className="ach-sec-title">
                  <span className="em" aria-hidden="true">{c.icon}</span>{c.label}
                </span>
                <span className="ach-sec-count">{c.earnedCount} / {c.total}</span>
              </div>
              <div className="ach-grid">
                {c.badges.map((b) => (
                  <div
                    key={b.def.id}
                    className={'ach-badge ' + (b.done ? 'on' : 'off')}
                    title={b.def.desc}
                  >
                    {!b.done && <span className="ach-lock" aria-hidden="true">🔒</span>}
                    <div className="ach-ico">{b.def.icon}</div>
                    <div className="ach-nm">{b.def.name}</div>
                    {b.done ? (
                      <div className="ach-dt">
                        {b.at && !b.backfilled ? fmtWhen(b.at) : 'получено'}
                      </div>
                    ) : (
                      <div className="ach-prog">
                        <div className="ach-pb"><i style={{ width: `${b.progress.pct}%` }} /></div>
                        <div className="ach-pt">
                          {fmtBadgeValue(b.def, b.progress.value)} / {fmtBadgeValue(b.def, b.progress.target)}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
