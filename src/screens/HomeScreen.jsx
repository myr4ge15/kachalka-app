import { useLiveQuery } from 'dexie-react-hooks'
import { getHomeSummary, getInsights, getFreshness } from '../db/insights.js'
import { fmtDaysAgo } from '../lib/homeSummary.js'
import { fmtTonnage, goalProgress } from '../lib/profileStats.js'
import { fmtMetricValue } from '../lib/metric.js'
import { tagSlug, groupAccusative, GROUP_ORDER } from '../lib/dayTags.js'
import { labelOf, majorOf } from '../lib/muscles.js'
import CardsSkeleton from '../components/CardsSkeleton.jsx'

// Полоска свежести в тизере — в каноническом порядке групп (стабильно), не по
// приоритету «пора». Группы вне канона уезжают в конец.
const canonIdx = (g) => {
  const i = GROUP_ORDER.indexOf(g)
  return i === -1 ? 99 : i
}

// Главный экран — «5 секунд после открытия» (виш BACKLOG «Домашняя сводка»).
// Персональная сводка + авто-инсайты. Всё из локальной базы (офлайн-доступно),
// живо обновляется через useLiveQuery. Дефолт-вкладка при входе (см. App.jsx).
//
// Пропсы: user, onNavigate(tab), onOpenProgress(exerciseId).
export default function HomeScreen({ user, onNavigate, onOpenProgress }) {
  const summary = useLiveQuery(() => getHomeSummary(user.id), [user.id])
  const insights = useLiveQuery(() => getInsights(user.id, { max: 3 }), [user.id], [])
  const freshness = useLiveQuery(() => getFreshness(user.id), [user.id])
  const loading = summary === undefined

  if (loading) {
    return (
      <div className="screen home">
        <h2 className="screen-title">Привет, {user.name}</h2>
        <CardsSkeleton cards={3} />
      </div>
    )
  }

  if (!summary.hasData) {
    return (
      <div className="screen home">
        <h2 className="screen-title">Привет, {user.name}</h2>
        <p className="muted empty">
          Здесь будет твоя сводка: последняя тренировка, серия, рекорды и авто-выводы.
          Запиши первую тренировку 💪
        </p>
        <button className="btn primary home-cta" onClick={() => onNavigate?.('history')}>
          + Записать тренировку
        </button>
      </div>
    )
  }

  const t = fmtTonnage(summary.tonnage.month)
  const pct = summary.tonnage.pct
  const lw = summary.lastWorkout

  // Тизер свежести: полоска групп (канонический порядок) + «пора» — самая
  // просроченная (recovery отсортирован приоритетом, [0] = самая пора).
  const rec = freshness?.recovery ?? []
  const strip = [...rec].sort((a, b) => canonIdx(a.group) - canonIdx(b.group))
  const lead = rec[0] && (rec[0].bucket === 'due' || rec[0].bucket === 'overdue') ? rec[0] : null

  return (
    <div className="screen home">
      <h2 className="screen-title">Привет, {user.name}</h2>

      {/* герой: когда была последняя тренировка + серия */}
      <div className="home-hero">
        <div className="home-hero-main">
          <div className="home-hero-k">Последняя тренировка</div>
          <div className="home-hero-v">{lw ? fmtDaysAgo(lw.daysAgo) : '—'}</div>
          {lw?.tags?.length > 0 && (
            <div className="home-tags">
              <span className="home-tags-lab">Мышцы:</span>
              {lw.tags.map((s) => (
                <span key={s} className={`day-tag tag-${tagSlug(majorOf(s))}`}>{labelOf(s)}</span>
              ))}
            </div>
          )}
        </div>
        {summary.streak > 0 && (
          <div className="home-streak" aria-label={`Серия: ${summary.streak}`}>
            <div className="home-streak-n">{summary.streak}<span className="u"> 🔥</span></div>
            <div className="home-streak-l">{summary.streak === 1 ? 'неделя' : 'недель'}<br />подряд</div>
          </div>
        )}
      </div>

      {/* инсайты — 2–3 авто-вывода */}
      {insights.length > 0 && (
        <section className="sec">
          <p className="sec-title">Выводы</p>
          <div className="ins-list">
            {insights.map((i) => (
              <div key={i.id} className={`ins-card ins-${i.tone}`}>
                <span className="ins-emoji" aria-hidden="true">{i.emoji}</span>
                <span className="ins-text">{i.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* быстрые цифры месяца */}
      <div className="stat-grid">
        <div className="stat-cell">
          <div className="stat-num">{summary.workoutsThisMonth}</div>
          <div className="stat-lab">тренировок<br />в этом месяце</div>
        </div>
        <div className="stat-cell">
          <div className="stat-num">{t.value}<span className="u"> {t.unit}</span></div>
          <div className="stat-lab">
            тоннаж за 30 дней
            {pct !== 0 && (
              <><br /><span className={pct > 0 ? 'delta up' : 'delta down'}>
                {pct > 0 ? `▲ +${pct}%` : `▼ ${pct}%`}
              </span></>
            )}
          </div>
        </div>
      </div>

      {/* свежесть групп — тизер, разворачивается в детальный экран */}
      {strip.length > 0 && (
        <section className="sec">
          <p className="sec-title">Свежесть групп</p>
          <button className="fr-teaser" onClick={() => onNavigate?.('freshness')}>
            <div className="fr-teaser-head">
              <span className="fr-teaser-lab">Восстановление по группам</span>
              <span className="go">Подробнее ›</span>
            </div>
            <div className="fr-strip">
              {strip.map((f) => (
                <div className="fr-strip-cell" key={f.group}>
                  <span className={`fr-bar fr-${f.bucket}`} aria-hidden="true" />
                  <span className="fr-strip-lab">{f.group}</span>
                </div>
              ))}
            </div>
            {lead ? (
              <div className="fr-lead">
                <span className="em" aria-hidden="true">🎯</span>
                <div className="fr-lead-body">
                  <div className="v">Пора проработать {groupAccusative(lead.group)}</div>
                  <div className="k">не тренировал {fmtDaysAgo(lead.daysSince)}</div>
                </div>
              </div>
            ) : (
              <div className="fr-lead calm">
                <span className="em" aria-hidden="true">💪</span>
                <div className="fr-lead-body">
                  <div className="v">Мышцы свежие</div>
                  <div className="k">все тренированные группы восстановились</div>
                </div>
              </div>
            )}
          </button>
        </section>
      )}

      {/* последний рекорд → Прогресс */}
      {summary.latestPr && (
        <section className="sec">
          <p className="sec-title">Последний рекорд</p>
          <div className="home-row static">
            <span className="em" aria-hidden="true">🏆</span>
            <div className="home-row-body">
              <div className="v">{summary.latestPr.name}</div>
              <div className="k">{fmtMetricValue(summary.latestPr.metric, summary.latestPr.value)}</div>
            </div>
          </div>
        </section>
      )}

      {/* ближайшая цель */}
      {summary.nearestGoal && (
        <section className="sec">
          <p className="sec-title">Ближайшая цель</p>
          <div className="goal">
            <div className="goal-top">
              <span className="lbl">
                {summary.nearestGoal.name}{' '}
                <b>
                  {fmtMetricValue(summary.nearestGoal.metric, summary.nearestGoal.target)}
                  {summary.nearestGoal.reps ? ` × ${summary.nearestGoal.reps}` : ''}
                </b>
              </span>
              <span className="pct">{summary.nearestGoal.pct}%</span>
            </div>
            <div className="bar"><i style={{ width: `${goalProgress(summary.nearestGoal.current, summary.nearestGoal.target)}%` }} /></div>
            <div className="goal-sub">
              текущий {fmtMetricValue(summary.nearestGoal.metric, summary.nearestGoal.current)} · осталось {fmtMetricValue(summary.nearestGoal.metric, summary.nearestGoal.left)}
            </div>
          </div>
        </section>
      )}

      {/* быстрые переходы */}
      <div className="home-actions">
        <button className="btn primary" onClick={() => onNavigate?.('history')}>+ Записать тренировку</button>
        <button className="btn ghost" onClick={() => onNavigate?.('progress')}>Прогресс</button>
        <button className="btn ghost" onClick={() => onNavigate?.('feed')}>Лента</button>
      </div>
    </div>
  )
}
