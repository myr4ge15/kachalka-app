import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getHomeData } from '../db/insights.js'
import { fmtDaysAgo, fmtDays } from '../lib/homeSummary.js'
import { fmtTonnage, goalProgress } from '../lib/profileStats.js'
import { fmtMetricValue } from '../lib/metric.js'
import { plural } from '../lib/plural.js'
import { tagSlug, groupAccusative, GROUP_ORDER } from '../lib/dayTags.js'
import { recoveryLead } from '../lib/freshness.js'
import { labelOf, majorOf } from '../lib/muscles.js'
import { useRevealFocus } from '../hooks/useRevealFocus.js'
import CardsSkeleton from '../components/CardsSkeleton.jsx'

// Полоска свежести в тизере — в каноническом порядке групп (стабильно), не по
// приоритету «пора». Группы вне канона уезжают в конец.
const canonIdx = (g) => {
  const i = GROUP_ORDER.indexOf(g)
  return i === -1 ? 99 : i
}

// Подсказка к цвету полоски (ось восстановления, та же, что у подписи).
const STATE_HINT = { ready: 'можно тренировать', almost: 'почти восстановилась', resting: 'дай отдых' }
const DAY_INITIALS = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В']

const localDate = (ymd) => new Date(`${ymd}T12:00:00`)
const shortMonth = (date) => new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
}).formatToParts(date).find((part) => part.type === 'month')?.value.replace('.', '') ?? ''

function weekRange(week) {
  const start = localDate(week.start)
  const end = localDate(week.end)
  const startDay = start.getDate()
  const endDay = end.getDate()
  const endMonth = shortMonth(end)
  if (start.getMonth() === end.getMonth()) return `${startDay}–${endDay} ${endMonth}`
  const startMonth = shortMonth(start)
  return `${startDay} ${startMonth} – ${endDay} ${endMonth}`
}

const workoutCount = (n) => `${n} ${plural(n, 'тренировка', 'тренировки', 'тренировок')}`
const dayLabel = (ymd) => localDate(ymd).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

// Главный экран — «5 секунд после открытия» (виш BACKLOG «Домашняя сводка»).
// Персональная сводка + авто-инсайты. Всё из локальной базы (офлайн-доступно),
// живо обновляется через useLiveQuery. Дефолт-вкладка при входе (см. App.jsx).
//
// Пропсы: user, onNavigate(tab), onNewWorkout() — прямой вход в композер новой
// тренировки (минуя список хаба), общий с плавающей кнопкой «+».
export default function HomeScreen({ user, onNavigate, onNewWorkout, onOpenProgress }) {
  const [openWeek, setOpenWeek] = useState(null)
  const openWeekRef = useRevealFocus(openWeek)
  // Одно чтение истории на все три блока Главной (сводка/инсайты/свежесть): раньше
  // было три отдельных useLiveQuery, каждый сканировал всю историю заново.
  const home = useLiveQuery(() => getHomeData(user.id, { max: 3 }), [user.id])
  const loading = home === undefined
  const summary = home?.summary
  const insights = home?.insights ?? []
  const freshness = home?.freshness

  if (loading) {
    return (
      <div className="screen home">
        <h2 className="screen-title">Привет, {user.name}!</h2>
        <CardsSkeleton cards={3} />
      </div>
    )
  }

  if (!summary.hasData) {
    return (
      <div className="screen home">
        <h2 className="screen-title">Привет, {user.name}!</h2>
        <p className="muted empty">
          Здесь будет твоя сводка: последняя тренировка, серия, рекорды и авто-выводы.
          Запиши первую тренировку 💪
        </p>
        <button className="btn primary home-cta" onClick={() => onNewWorkout?.()}>
          + Записать тренировку
        </button>
      </div>
    )
  }

  const t = fmtTonnage(summary.tonnage.month)
  const pct = summary.tonnage.pct
  const lw = summary.lastWorkout
  const rhythm = summary.rhythm ?? []
  const rhythmCount = rhythm.reduce((n, w) => n + w.count, 0)

  // Тизер свежести: полоска групп (канонический порядок) + подпись. Карточка
  // называется «Восстановление по группам» → и цвет полоски, и подпись читают ОДНУ
  // ось — `state` (порог восстановления), а не давность `bucket` (иначе «всё красное,
  // но все восстановились»). Про давность говорит только ветка «пора проработать».
  const rec = freshness?.recovery ?? []
  const strip = [...rec].sort((a, b) => canonIdx(a.group) - canonIdx(b.group))
  const lead = recoveryLead(rec)

  return (
    <div className="screen home">
      <h2 className="screen-title">Привет, {user.name}!</h2>

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

      {/* Восемь календарных недель. Строка недели — удобная тап-зона, которая
          раскрывает даты и группы; История остаётся отдельным явным действием. */}
      {rhythm.length > 0 && (
        <section className="sec">
          <p className="sec-title">Тренировочный ритм</p>
          <div className="rhythm-card">
            <div className="rhythm-head">
              <span>
                <b>{rhythmCount}</b> {plural(rhythmCount, 'тренировка', 'тренировки', 'тренировок')} за 8 недель
              </span>
              <span className="rhythm-hint">Нажми неделю — увидишь даты</span>
            </div>
            <div className="rhythm-weeks">
              {rhythm.map((week) => {
                const expanded = openWeek === week.key
                const trainedDays = week.days.filter((d) => d.count > 0)
                return (
                  <div
                    className="rhythm-week-wrap"
                    key={week.key}
                    ref={expanded ? openWeekRef : null}
                  >
                    <button
                      className={`rhythm-week${week.current ? ' current' : ''}`}
                      onClick={() => setOpenWeek(expanded ? null : week.key)}
                      aria-expanded={expanded}
                      aria-controls={`rhythm-detail-${week.key}`}
                      aria-label={`${weekRange(week)}: ${workoutCount(week.count)}`}
                    >
                      <span className="rhythm-week-copy">
                        <b>{week.current ? 'Эта неделя' : weekRange(week)}</b>
                        <span>
                          {week.current
                            ? `${weekRange(week)} · ${week.count} трен.`
                            : workoutCount(week.count)}
                        </span>
                      </span>
                      <span className="rhythm-days" aria-hidden="true">
                        {week.days.map((d, index) => (
                          <span
                            key={d.day}
                            className={[
                              'rhythm-day',
                              d.count > 0 ? 'trained' : '',
                              d.count > 1 ? 'multi' : '',
                              d.today ? 'today' : '',
                              d.future ? 'future' : '',
                            ].filter(Boolean).join(' ')}
                          >
                            {DAY_INITIALS[index]}
                          </span>
                        ))}
                      </span>
                      <span className="rhythm-chevron" aria-hidden="true">{expanded ? '−' : '+'}</span>
                    </button>
                    {expanded && (
                      <div className="rhythm-detail" id={`rhythm-detail-${week.key}`}>
                        {trainedDays.length > 0 ? trainedDays.map((d) => {
                          const groups = [...new Set(d.tags.map(labelOf))]
                          return (
                            <div className="rhythm-session" key={d.day}>
                              <span><b>{dayLabel(d.day)}</b>{d.today ? ' · сегодня' : ''}</span>
                              <span>
                                {workoutCount(d.count)}
                                {groups.length > 0 ? ` · ${groups.join(', ')}` : ''}
                              </span>
                            </div>
                          )
                        }) : (
                          <span className="rhythm-empty">На этой неделе тренировок не было</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <button className="rhythm-history" onClick={() => onNavigate?.('history')}>
              Открыть всю историю <span aria-hidden="true">›</span>
            </button>
          </div>
        </section>
      )}

      {/* инсайты — 2–3 авто-вывода */}
      {insights.length > 0 && (
        <section className="sec">
          <p className="sec-title">Наблюдения</p>
          <div className="ins-list">
            {insights.map((i) => {
              const content = (
                <>
                <span className="ins-emoji" aria-hidden="true">{i.emoji}</span>
                <span className="ins-text">{i.text}</span>
                </>
              )
              return i.kind === 'past-self' && i.exerciseId && onOpenProgress ? (
                <button
                  key={i.id}
                  className={`ins-card action ins-${i.tone}`}
                  onClick={() => onOpenProgress(i.exerciseId)}
                >
                  {content}
                  <span className="go" aria-hidden="true">›</span>
                </button>
              ) : (
                <div key={i.id} className={`ins-card ins-${i.tone}`}>{content}</div>
              )
            })}
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

      {/* готовность мышц — тизер, разворачивается в детальный экран */}
      {strip.length > 0 && (
        <section className="sec">
          <p className="sec-title">Готовность мышц</p>
          <button className="fr-teaser" onClick={() => onNavigate?.('freshness')}>
            <div className="fr-teaser-head">
              <span className="fr-teaser-lab">Что уже восстановилось</span>
              <span className="go">Подробнее ›</span>
            </div>
            <div className="fr-strip">
              {strip.map((f) => (
                <div className="fr-strip-cell" key={f.group}>
                  <span
                    className={`fr-bar st-${f.state}`}
                    aria-hidden="true"
                    title={STATE_HINT[f.state]}
                  />
                  <span className="fr-strip-lab">{f.group}</span>
                </div>
              ))}
            </div>
            {lead?.kind === 'target' ? (
              <div className="fr-lead">
                <span className="em" aria-hidden="true">🎯</span>
                <div className="fr-lead-body">
                  <div className="v">Пора проработать {groupAccusative(lead.item.group)}</div>
                  <div className="k">не тренировал уже {fmtDays(lead.item.daysSince)}</div>
                </div>
              </div>
            ) : lead?.kind === 'resting' ? (
              <div className="fr-lead">
                <span className="em" aria-hidden="true">😴</span>
                <div className="fr-lead-body">
                  <div className="v">Мышцы восстанавливаются</div>
                  <div className="k">
                    ещё отдыхают: {lead.items.map((f) => f.group).join(', ')}
                  </div>
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

      {/* Быстрые переходы. «+ Записать тренировку» отсюда убрана (v5.4.1): её роль
          взяла плавающая «+» — она видна всегда, а эта кнопка лежала ниже сгиба
          длинной сводки. В ПУСТОМ состоянии (ветка выше) явный CTA остаётся: у
          новичка ещё нет привычки к FAB, и его надо чему-то научить. */}
      <div className="home-actions">
        <button className="btn ghost" onClick={() => onNavigate?.('progress')}>Прогресс</button>
        <button className="btn ghost" onClick={() => onNavigate?.('feed')}>Лента</button>
      </div>
    </div>
  )
}
