import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getFreshness } from '../db/insights.js'
import { getWorkouts } from '../db/repo.js'
import { groupVolumeTrend, trendLabel, WEEKS } from '../lib/groupVolume.js'
import { plural } from '../lib/plural.js'
import { readinessView, recoveryLead, fmtHoursLeft, regionTarget } from '../lib/freshness.js'
import { fmtDaysAgo } from '../lib/homeSummary.js'
import { LEAD_TARGET, leadSince, cardioLine } from '../lib/recoveryText.js'
import { labelOf } from '../lib/muscles.js'
import { groupAccusative } from '../lib/dayTags.js'
import { byGender } from '../lib/gender.js'
import MuscleMap, { regionOf, regionSubs, regionLabel } from '../components/exercises/MuscleMap.jsx'
import CardsSkeleton from '../components/ui/CardsSkeleton.jsx'
import BackButton from '../components/ui/BackButton.jsx'

// Экран «Готовность мышц» (v6.2.5, макет — prototypes/freshness.html, «А · компактнее»).
// Раньше: карта + длинный список «Когда снова тренировать» (по строке на подмышцу,
// 15–25 строк) + отдельный «Дисбаланс». Теперь все на одной оси ГОТОВНОСТИ и без
// прокрутки: подсказка «что сегодня» → карта (раскраска по готовности) →
// переключатель «можно / отдыхают / давно» со счетчиками → мышцы выбранной корзины
// «таблетками» → строка деталей по нажатию. Раскладка — чистая readinessView.
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const TABS = [
  { id: 'ready', label: 'можно' },
  { id: 'resting', label: 'отдыхают' },
  { id: 'old', label: 'давно' },
]

// Подсказка сверху — та же логика, что у тизера Главной (recoveryLead по группам),
// чтобы Главная и этот экран не противоречили друг другу.
// v6.3.5: группа-цель — кнопка: подсвечивает ее мышцы на карте и в «таблетках».
// v7.5.6: текст — lib/recoveryText (как на Главной), без рода глагола; кардио в
// подсказку про мышцы не попадает, о нем — отдельная тихая строка (cardioDays).
function Tip({ lead, cardioDays, onFocusGroup }) {
  if (!lead && cardioDays == null) return null
  let text = null
  if (lead?.kind === 'target') {
    const g = groupAccusative(lead.item.group)
    const word = onFocusGroup
      ? <button type="button" className="fr-tip-target" onClick={() => onFocusGroup(lead.item.group)}>{g}</button>
      : <b>{g}</b>
    text = <>{LEAD_TARGET} {word} — {leadSince(lead.item.daysSince)}</>
  } else if (lead?.kind === 'resting') {
    text = <>Отдыхают: <b>{lead.items.map((f) => f.group).join(', ')}</b>. Остальное можно тренировать</>
  } else if (lead) {
    text = <>Все тренированные мышцы восстановились — <b>выбирай любую группу</b></>
  }
  return (
    <div className="fr-tip">
      <span className="em" aria-hidden="true">{text ? '🎯' : '🏃'}</span>
      <div className="fr-tip-body">
        {text && <p>{text}</p>}
        {cardioDays != null && <p className="fr-tip-cardio">{text && <span aria-hidden="true">🏃 </span>}{cardioLine(cardioDays)}</p>}
      </div>
    </div>
  )
}

// Группу (major) не повторяем, если она совпадает с названием мышцы: было «Бицепс · бицепс» (v6.3.5).
function detailText(item, sex) {
  const trained = byGender(sex, 'тренировал', 'тренировала')
  const when = item.status === 'ready'
    ? 'можно тренировать'
    : item.status === 'resting'
      ? `${item.almost ? 'почти восстановилась, ' : 'отдыхает, '}готова ${fmtHoursLeft(item.hoursLeft)}`
      : item.status === 'stale' ? `давно не ${trained} — стоит вернуть` : `ни разу не ${trained}`
  const ago = item.daysSince == null ? null : fmtDaysAgo(item.daysSince)
  const major = item.major && item.major.toLowerCase() !== String(labelOf(item.submuscle)).toLowerCase() ? item.major : null
  return [major, ago, when].filter(Boolean).join(' · ')
}

// Динамика объема по группам (v6.5.0): строка = группа · мини-столбики по неделям ·
// подходов в неделю · тренд «последние 2 недели против 2 предыдущих». Не новый
// экран, а разрез под картой готовности (BACKLOG «Прогресс… и динамика по группам»).
function GroupVolume({ rows }) {
  if (!rows?.length) return null
  const max = Math.max(1, ...rows.flatMap((r) => r.weeks))
  return (
    <section className="gv" aria-labelledby="gv-title">
      <h3 className="sec-title gv-title" id="gv-title">Объем по группам</h3>
      <p className="gv-sub muted">Рабочие подходы за {WEEKS} недели; тренд — две последние против двух прошлых.</p>
      <ul className="gv-list">
        {rows.map((r) => (
          <li key={r.group} className="gv-row">
            <span className="gv-name">{cap(r.group)}</span>
            <span className="gv-bars" aria-hidden="true">
              {r.weeks.map((n, i) => (
                <i key={i} className={i === r.weeks.length - 1 ? 'now' : ''} style={{ height: `${Math.max(8, (n / max) * 100)}%`, opacity: n ? 1 : 0.35 }} />
              ))}
            </span>
            <span className="gv-num">
              <b>{String(r.perWeek).replace('.', ',')}</b> {plural(Math.ceil(r.perWeek), 'подход', 'подхода', 'подходов')}/нед.
            </span>
            <span className={`gv-trend gv-trend--${r.trend}`}>{trendLabel(r)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function FreshnessScreen({ user, onBack }) {
  const data = useLiveQuery(() => getFreshness(user.id), [user.id])
  const volume = useLiveQuery(() => getWorkouts(user.id).then((w) => groupVolumeTrend(w, Date.now())), [user.id], [])
  const loading = data === undefined
  const view = readinessView(data?.recoverySub, data?.imbalanceSub)
  const lead = recoveryLead(data?.recovery ?? [])
  const [tabPick, setTabPick] = useState(null)
  const [sel, setSel] = useState(null) // выбранная подмышца
  const [region, setRegion] = useState(null) // выбранная зона карты
  // Подсветка группы из подсказки «Сегодня пора проработать …» (v6.3.5) — только по
  // нажатию на подсказку. С v8.8.0 при входе ничего не подсвечено (решение владельца
  // 15.10: мышца подсвечивается, только когда ее выбрал сам человек).
  const [focusPick, setFocusPick] = useState(null)
  const focusGroup = focusPick
  const inFocus = (x) => Boolean(focusGroup) && x.major === focusGroup
  // По умолчанию — корзина с подсвеченной группой, иначе первая непустая, начиная с «можно».
  const focusTab = focusGroup ? TABS.find((t) => view[t.id].some(inFocus))?.id : null
  const tab = tabPick ?? focusTab ?? TABS.find((t) => view[t.id].length > 0)?.id ?? 'ready'
  const list = view[tab]
  const selected = list.find((x) => x.submuscle === sel) ?? null
  const focusSub = list.find(inFocus)?.submuscle
  const mapSelected = selected ? regionOf(selected.submuscle) : region ?? (focusSub ? regionOf(focusSub) : null)

  const pickTab = (id) => { setTabPick(id); setSel(null); setRegion(null); setFocusPick(null) }
  const pickSub = (s) => { setSel((cur) => (cur === s ? null : s)); setRegion(null); setFocusPick(null) }
  // Нажатие на зону карты (v7.5.5): открыть корзину, где мышцы зоны есть; одна мышца
  // в зоне — сразу выбрать (детали внизу), несколько — подсветить таблетки. Повторное
  // нажатие на ту же зону снимает выбор.
  const pickRegion = (r) => {
    setFocusPick(null)
    if (region === r || (selected && regionOf(selected.submuscle) === r)) { setRegion(null); setSel(null); return }
    const hit = regionTarget(view, TABS.map((t) => t.id), tab, regionSubs(r))
    if (hit) setTabPick(hit.tab)
    if (hit?.items.length === 1) { setSel(hit.items[0].submuscle); setRegion(null) } else { setSel(null); setRegion(r) }
  }
  const regionHit = !selected && region ? regionTarget(view, TABS.map((t) => t.id), tab, regionSubs(region)) : null
  const focusOn = (g) => { setFocusPick(g); setTabPick(null); setSel(null); setRegion(null) }

  return (
    <div className="screen fresh-screen">
      <div className="admin-head">
        <BackButton onClick={onBack} />
        <h2 className="admin-title">Восстановление</h2>
      </div>

      {loading ? (
        <CardsSkeleton cards={3} />
      ) : (data?.recoverySub ?? []).length === 0 ? (
        <p className="muted empty">
          Запиши тренировку — покажу, какие мышцы отдохнули и пора ли их снова нагружать.
        </p>
      ) : (
        <>
          <Tip lead={lead} cardioDays={data?.cardio ?? null} onFocusGroup={focusOn} />

          <div className="fr-map">
            <MuscleMap bySub={view.bySub} selected={mapSelected} selectedSub={selected?.submuscle ?? null} onSelect={pickRegion} />
            <div className="fr-legend">
              <span><i className="fr-sw st-ready" />можно</span>
              <span><i className="fr-sw st-resting" />отдыхает</span>
              <span><i className="fr-sw st-almost" />почти</span>
              <span><i className="fr-sw st-stale" />давно</span>
              <span><i className="fr-sw st-never" />ни разу</span>
              <span><i className="fr-sw fr-untracked" />нет данных</span>
            </div>
          </div>

          <div className="fr-tabs" role="tablist" aria-label="Готовность">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`fr-tab fr-tab--${t.id}${tab === t.id ? ' on' : ''}`}
                onClick={() => pickTab(t.id)}
              >
                <b>{view[t.id].length}</b>{t.label}
              </button>
            ))}
          </div>

          {list.length === 0 ? (
            <p className="muted fr-none">
              {tab === 'resting' ? 'Сейчас ничего не отдыхает.' : tab === 'old' ? 'Все под контролем — ничего не заброшено.' : 'Пока все отдыхает.'}
            </p>
          ) : (
            <div className="fr-chips">
              {list.map((x) => {
                const inRegion = (region && regionOf(x.submuscle) === region) || (!region && !sel && inFocus(x))
                return (
                  <button
                    key={x.submuscle}
                    type="button"
                    className={`fr-chip${sel === x.submuscle ? ' on' : ''}${inRegion ? ' hl' : ''}`}
                    aria-pressed={sel === x.submuscle}
                    onClick={() => pickSub(x.submuscle)}
                  >
                    <i className={`fr-sw st-${x.almost ? 'almost' : x.status}`} aria-hidden="true" />
                    {labelOf(x.submuscle)}
                  </button>
                )
              })}
            </div>
          )}

          <p className="fr-detail" aria-live="polite">
            {selected
              ? <><b>{cap(labelOf(selected.submuscle))}</b> · {detailText(selected, data?.sex)}</>
              : region && regionHit
                ? <><b>{cap(regionLabel(region))}</b> · подсветил {regionHit.items.length} {plural(regionHit.items.length, 'мышцу', 'мышцы', 'мышц')} выше — нажми на нужную</>
              : region
                ? <><b>{cap(regionLabel(region))}</b> · нет данных: {byGender(data?.sex, 'не тренировал', 'не тренировала')} ни разу</>
              : `Нажми на мышцу — покажу, когда ${byGender(data?.sex, 'тренировал', 'тренировала')} и когда снова можно.`}
          </p>

          <GroupVolume rows={volume} />
        </>
      )}
    </div>
  )
}
