import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getFreshness } from '../db/insights.js'
import { readinessView, recoveryLead, fmtHoursLeft } from '../lib/freshness.js'
import { fmtDaysAgo, fmtDays } from '../lib/homeSummary.js'
import { labelOf } from '../lib/muscles.js'
import { groupAccusative } from '../lib/dayTags.js'
import { byGender } from '../lib/gender.js'
import MuscleMap, { regionOf } from '../components/MuscleMap.jsx'
import CardsSkeleton from '../components/CardsSkeleton.jsx'
import BackButton from '../components/BackButton.jsx'

// Экран «Готовность мышц» (v6.2.5, макет — prototypes/freshness.html, «А · компактнее»).
// Раньше: карта + длинный список «Когда снова тренировать» (по строке на подмышцу,
// 15–25 строк) + отдельный «Дисбаланс». Теперь всё на одной оси ГОТОВНОСТИ и без
// прокрутки: подсказка «что сегодня» → карта (раскраска по готовности) →
// переключатель «можно / отдыхают / давно» со счётчиками → мышцы выбранной корзины
// «таблетками» → строка деталей по нажатию. Раскладка — чистая readinessView.
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const TABS = [
  { id: 'ready', label: 'можно' },
  { id: 'resting', label: 'отдыхают' },
  { id: 'old', label: 'давно' },
]

// Подсказка сверху — та же логика, что у тизера Главной (recoveryLead по группам),
// чтобы Главная и этот экран не противоречили друг другу.
function Tip({ lead, sex }) {
  if (!lead) return null
  let text
  if (lead.kind === 'target') {
    text = <>Сегодня пора проработать <b>{groupAccusative(lead.item.group)}</b> — не {byGender(sex, 'тренировал', 'тренировала')} уже {fmtDays(lead.item.daysSince)}</>
  } else if (lead.kind === 'resting') {
    text = <>Отдыхают: <b>{lead.items.map((f) => f.group).join(', ')}</b>. Остальное можно тренировать</>
  } else {
    text = <>Все тренированные мышцы восстановились — <b>выбирай любую группу</b></>
  }
  return (
    <div className="fr-tip">
      <span className="em" aria-hidden="true">🎯</span>
      <p>{text}</p>
    </div>
  )
}

function detailText(item, sex) {
  const trained = byGender(sex, 'тренировал', 'тренировала')
  const when = item.status === 'ready'
    ? 'можно тренировать'
    : item.status === 'resting'
      ? `${item.almost ? 'почти восстановилась, ' : 'отдыхает, '}готова ${fmtHoursLeft(item.hoursLeft)}`
      : item.status === 'stale' ? `давно не ${trained} — стоит вернуть` : `ни разу не ${trained}`
  const ago = item.daysSince == null ? null : fmtDaysAgo(item.daysSince)
  return [item.major, ago, when].filter(Boolean).join(' · ')
}

export default function FreshnessScreen({ user, onBack }) {
  const data = useLiveQuery(() => getFreshness(user.id), [user.id])
  const loading = data === undefined
  const view = readinessView(data?.recoverySub, data?.imbalanceSub)
  const lead = recoveryLead(data?.recovery ?? [])
  const [tabPick, setTabPick] = useState(null)
  const [sel, setSel] = useState(null) // выбранная подмышца
  const [region, setRegion] = useState(null) // выбранная зона карты
  // По умолчанию — первая непустая корзина, начиная с «можно».
  const tab = tabPick ?? TABS.find((t) => view[t.id].length > 0)?.id ?? 'ready'
  const list = view[tab]
  const selected = list.find((x) => x.submuscle === sel) ?? null
  const mapSelected = selected ? regionOf(selected.submuscle) : region

  const pickTab = (id) => { setTabPick(id); setSel(null); setRegion(null) }
  const pickSub = (s) => { setSel((cur) => (cur === s ? null : s)); setRegion(null) }
  const pickRegion = (r) => { setRegion((cur) => (cur === r ? null : r)); setSel(null) }

  return (
    <div className="screen fresh-screen">
      <div className="admin-head">
        <BackButton onClick={onBack} />
        <h2 className="admin-title">Готовность мышц</h2>
      </div>

      {loading ? (
        <CardsSkeleton cards={3} />
      ) : (data?.recoverySub ?? []).length === 0 ? (
        <p className="muted empty">
          Запиши тренировку — покажу, какие мышцы отдохнули и пора ли их снова нагружать.
        </p>
      ) : (
        <>
          <Tip lead={lead} sex={data?.sex} />

          <div className="fr-map">
            <MuscleMap bySub={view.bySub} selected={mapSelected} onSelect={pickRegion} />
            <div className="fr-legend">
              <span><i className="fr-sw st-ready" />можно</span>
              <span><i className="fr-sw st-resting" />отдыхает</span>
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
              {tab === 'resting' ? 'Сейчас ничего не отдыхает.' : tab === 'old' ? 'Всё под контролем — ничего не заброшено.' : 'Пока всё отдыхает.'}
            </p>
          ) : (
            <div className="fr-chips">
              {list.map((x) => {
                const inRegion = region && regionOf(x.submuscle) === region
                return (
                  <button
                    key={x.submuscle}
                    type="button"
                    className={`fr-chip${sel === x.submuscle ? ' on' : ''}${inRegion ? ' hl' : ''}`}
                    aria-pressed={sel === x.submuscle}
                    onClick={() => pickSub(x.submuscle)}
                  >
                    <i className={`fr-sw st-${x.status}`} aria-hidden="true" />
                    {cap(labelOf(x.submuscle))}
                  </button>
                )
              })}
            </div>
          )}

          <p className="fr-detail" aria-live="polite">
            {selected
              ? <><b>{cap(labelOf(selected.submuscle))}</b> · {detailText(selected, data?.sex)}</>
              : `Нажми на мышцу — покажу, когда ${byGender(data?.sex, 'тренировал', 'тренировала')} и когда снова можно.`}
          </p>
        </>
      )}
    </div>
  )
}
