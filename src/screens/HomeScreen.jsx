import { useEffect, useRef, useState } from 'react'
import { fmtHomeTitle } from '../lib/dates.js'
import { useLiveQuery } from 'dexie-react-hooks'
import { getHomeData } from '../db/insights.js'
import { fmtDaysAgo, fmtDays } from '../lib/homeSummary.js'
import { fmtTonnage, goalProgress } from '../lib/profileStats.js'
import { fmtMetricValue } from '../lib/metric.js'
import { plural } from '../lib/plural.js'
import { tagSlug, groupAccusative, GROUP_ORDER } from '../lib/dayTags.js'
import { recoveryLead } from '../lib/freshness.js'
import { labelOf, majorOf } from '../lib/muscles.js'
import { byGender } from '../lib/gender.js'
import { rhythmChart, fmtAvg, avgWord, mondayLabel } from '../lib/rhythmChart.js'
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

const weeksWord = (n) => plural(n, 'неделю', 'недели', 'недель')
const workoutCount = (n) => `${n} ${plural(n, 'тренировка', 'тренировки', 'тренировок')}`
const dayLabel = (ymd) => localDate(ymd).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

// Главный экран — «5 секунд после открытия» (виш BACKLOG «Домашняя сводка»).
// Персональная сводка + авто-инсайты. Все из локальной базы (офлайн-доступно),
// живо обновляется через useLiveQuery. Дефолт-вкладка при входе (см. App.jsx).
//
// Пропсы: user, onNavigate(tab), onNewWorkout() — прямой вход в композер новой
// тренировки (минуя список хаба), общий с «+» в нижнем меню.
export default function HomeScreen({ user, onNavigate, onNewWorkout, onOpenProgress, onOpenCalendar, focusRhythm = false, onFocusRhythmConsumed }) {
  const [openWeek, setOpenWeek] = useState(null)
  const openWeekRef = useRevealFocus(openWeek)
  // Одно чтение истории на все три блока Главной (сводка/инсайты/свежесть): раньше
  // было три отдельных useLiveQuery, каждый сканировал всю историю заново.
  const home = useLiveQuery(() => getHomeData(user.id, { max: 3 }), [user.id])
  const loading = home === undefined
  const summary = home?.summary
  const insights = home?.insights ?? []
  const freshness = home?.freshness

  // Вернулись из календаря/тренировки, открытых из Ритма (v6.3.5): докручиваем к Ритму.
  // Ждем загрузки данных — до нее блока нет; после прокрутки гасим интент у App.
  const rhythmRef = useRef(null)
  useEffect(() => {
    if (!focusRhythm || loading) return
    rhythmRef.current?.scrollIntoView?.({ block: 'start' })
    onFocusRhythmConsumed?.()
  }, [focusRhythm, loading, onFocusRhythmConsumed])

  if (loading) {
    return (
      <div className="screen home">
        <h2 className="screen-title">{fmtHomeTitle()}</h2>
        <CardsSkeleton cards={3} />
      </div>
    )
  }

  if (!summary.hasData) {
    return (
      <div className="screen home">
        <h2 className="screen-title">{fmtHomeTitle()}</h2>
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
  const chart = rhythmChart(rhythm)
  const openW = rhythm.find((w) => w.key === openWeek) ?? null
  const openDays = openW ? openW.days.filter((d) => d.count > 0) : []

  // Тизер свежести: полоска групп (канонический порядок) + подпись. Карточка
  // называется «Восстановление по группам» → и цвет полоски, и подпись читают ОДНУ
  // ось — `state` (порог восстановления), а не давность `bucket` (иначе «все красное,
  // но все восстановились»). Про давность говорит только ветка «пора проработать».
  const rec = freshness?.recovery ?? []
  const strip = [...rec].sort((a, b) => canonIdx(a.group) - canonIdx(b.group))
  const lead = recoveryLead(rec)

  // Порядок блоков (редизайн v6, этап 3; отзывы друзей): действие → серия и цифры →
  // готовность мышц и ближайшая цель ВВЕРХУ → ритм → наблюдения → рекорд.
  return (
    <div className="screen home">
      <h2 className="screen-title">{fmtHomeTitle()}</h2>

      {/* Главное действие. Дублирует «+» меню намеренно: на Главной это первое, что
          ищет глаз, и сразу видно, как давно была прошлая тренировка. */}
      <button className="home-go" onClick={() => onNewWorkout?.()}>
        <span className="home-go-txt">
          <b>Начать тренировку</b>
          <span>последняя — {lw ? fmtDaysAgo(lw.daysAgo) : '—'}</span>
        </span>
        <span className="home-go-ico" aria-hidden="true">+</span>
      </button>
      {lw?.tags?.length > 0 && (
        <div className="home-tags">
          <span className="home-tags-lab">В прошлый раз:</span>
          {lw.tags.map((s) => (
            <span key={s} className={`day-tag tag-${tagSlug(majorOf(s))}`}>{labelOf(s)}</span>
          ))}
        </div>
      )}

      {/* Два блока: серия недель и цифры месяца. */}
      <div className="home-blocks">
        <div className="home-block" aria-label={`Серия: ${summary.streak} ${plural(summary.streak, 'неделя', 'недели', 'недель')} подряд`}>
          <div className="home-block-k">Серия</div>
          <div className="home-block-n">{summary.streak}<span className="u"> нед.</span></div>
          <div className="home-block-l">{summary.streak > 0 ? 'подряд с тренировками' : 'начни новую на этой неделе'}</div>
        </div>
        <div className="home-block">
          <div className="home-block-k">Тоннаж · 30 дн.</div>
          <div className="home-block-n">{t.value}<span className="u"> {t.unit}</span></div>
          <div className="home-block-l">
            {pct !== 0 && (
              <span className={pct > 0 ? 'delta up' : 'delta down'}>
                {pct > 0 ? `▲ +${pct}%` : `▼ ${pct}%`}{' · '}
              </span>
            )}
            {summary.workoutsThisMonth} трен. в этом месяце
          </div>
        </div>
      </div>

      {/* готовность мышц — тизер, разворачивается в детальный экран */}
      {strip.length > 0 && (
        <section className="sec">
          <p className="sec-title">Восстановление</p>
          <button className="fr-teaser" onClick={() => onNavigate?.('freshness')}>
            <div className="fr-teaser-head">
              <span className="fr-teaser-lab">Готовы к нагрузке</span>
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
                  <div className="k">не {byGender(home?.sex, 'тренировал', 'тренировала')} уже {fmtDays(lead.item.daysSince)}</div>
                </div>
              </div>
            ) : lead?.kind === 'resting' ? (
              <div className="fr-lead">
                <span className="em" aria-hidden="true">😴</span>
                <div className="fr-lead-body">
                  <div className="v">Мышцы восстанавливаются</div>
                  <div className="k">
                    еще отдыхают: {lead.items.map((f) => f.group).join(', ')}
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

      {/* ближайшая цель */}
      {summary.nearestGoal && (
        <section className="sec">
          <p className="sec-title">Ближайшая цель</p>
          <div className="goal">
            <div className="goal-top">
              <span className="lbl">
                {summary.nearestGoal.name}:{' '}
                <b>
                  {fmtMetricValue(summary.nearestGoal.metric, summary.nearestGoal.target)}
                  {summary.nearestGoal.reps ? ` × ${summary.nearestGoal.reps}` : ''}
                </b>
              </span>
              <span className="pct">{summary.nearestGoal.pct}%</span>
            </div>
            <div className="bar"><i style={{ width: `${goalProgress(summary.nearestGoal.current, summary.nearestGoal.target)}%` }} /></div>
            <div className="goal-sub">
              текущий: {fmtMetricValue(summary.nearestGoal.metric, summary.nearestGoal.current)} · осталось: {fmtMetricValue(summary.nearestGoal.metric, summary.nearestGoal.left)}
            </div>
          </div>
        </section>
      )}

      {/* Ритм v2 (отзыв «непонятно»): столбик на неделю, число — над ним, понедельник —
          под ним, пунктир — среднее за завершенные недели. Тап по столбику раскрывает
          даты и группы этой недели под графиком. Высоты — CSS из чисел в переменных
          (--rh-n / --rh-max / --rh-avg), цвета — только токены. */}
      {rhythm.length > 0 && (
        <section className="sec" ref={rhythmRef}>
          <p className="sec-title">Ритм</p>
          <div className="rhythm-card">
            {/* Шапка: среднее в неделю, а если оно меньше одной или считать еще не
                из чего — честный итог за период (lib/rhythmChart.js, mode). */}
            <div className="rh-top">
              {chart.mode === 'avg' ? (
                <>
                  <span className="rh-avg-n">{fmtAvg(chart.avg)}</span>
                  <span className="rh-avg-l">
                    {avgWord(chart.avg)} в неделю
                    <br />в среднем
                  </span>
                </>
              ) : (
                <>
                  <span className="rh-avg-n">{chart.total}</span>
                  <span className="rh-avg-l">
                    {plural(chart.total, 'тренировка', 'тренировки', 'тренировок')}
                    <br />{chart.onlyCurrent ? 'на этой неделе' : `за ${chart.weeks} ${weeksWord(chart.weeks)}`}
                  </span>
                </>
              )}
            </div>
            <div
              className="rh-chart"
              style={{ '--rh-max': chart.max, '--rh-avg': chart.avg }}
            >
              {chart.mode === 'avg' && <span className="rh-avg-line" aria-hidden="true" />}
              {rhythm.map((week) => {
                const expanded = openWeek === week.key
                return (
                  <button
                    key={week.key}
                    className={[
                      'rh-col',
                      week.current ? 'current' : '',
                      week.count === 0 ? 'zero' : '',
                      expanded ? 'on' : '',
                    ].filter(Boolean).join(' ')}
                    style={{ '--rh-n': week.count }}
                    onClick={() => setOpenWeek(expanded ? null : week.key)}
                    aria-expanded={expanded}
                    aria-controls={`rhythm-detail-${week.key}`}
                    aria-label={`${weekRange(week)}: ${workoutCount(week.count)}`}
                  >
                    <span className="rh-num" aria-hidden="true">{week.count > 0 ? week.count : ''}</span>
                    <span className="rh-plot" aria-hidden="true"><span className="rh-bar" /></span>
                    <span className="rh-date" aria-hidden="true">{mondayLabel(week)}</span>
                  </button>
                )
              })}
            </div>
            {openW && (
              <div className="rhythm-detail" id={`rhythm-detail-${openW.key}`} ref={openWeekRef}>
                <div className="rhythm-detail-h">
                  {openW.current ? 'Эта неделя' : weekRange(openW)} · {workoutCount(openW.count)}
                </div>
                {openDays.length > 0 ? openDays.map((d) => {
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
            <p className="rh-note">
              Один столбик — одна неделя: сверху число тренировок, снизу дата, с которой неделя
              началась.{chart.mode === 'avg' ? ' Пунктир — твое среднее.' : ''} Нажми
              на столбик, чтобы увидеть дни и мышцы.
            </p>
            {/* v6.3.0: ведет в календарь «Моих тренировок». Открыта неделя с
                тренировками — календарь сразу показывает ее последний день. */}
            <button
              className="rhythm-history"
              onClick={() => (onOpenCalendar ? onOpenCalendar(openDays.at(-1)?.day ?? null) : onNavigate?.('history'))}
            >
              Открыть в календаре <span aria-hidden="true">›</span>
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

      {/* последний рекорд */}
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
    </div>
  )
}
