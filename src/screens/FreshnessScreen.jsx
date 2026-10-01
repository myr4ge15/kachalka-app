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
function Tip({ lead, sex, onFocusGroup }) {
  if (!lead) return null
  let text
  if (lead.kind === 'target') {
    const g = groupAccusative(lead.item.group)
    const word = onFocusGroup
      ? <button type="button" className="fr-tip-target" onClick={() => onFocusGroup(lead.item.group)}>{g}</button>
      : <b>{g}</b>
    text = <>Сегодня пора проработать {word} — не {byGender(sex, 'тренировал', 'тренировала')} уже {fmtDays(lead.item.daysSince)}</>
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

export default function FreshnessScreen({ user, onBack }) {
  const data = useLiveQuery(() => getFreshness(user.id), [user.id])
  const loading = data === undefined
  const view = readinessView(data?.recoverySub, data?.imbalanceSub)
  const lead = recoveryLead(data?.recovery ?? [])
  const [tabPick, setTabPick] = useState(null)
  const [sel, setSel] = useState(null) // выбранная подмышца
  const [region, setRegion] = useState(null) // выбранная зона карты
  // Подсветка группы из подсказки «Сегодня пора проработать …» (v6.3.5). undefined —
  // пользователь еще ничего не выбирал: тогда подсвечиваем группу-цель сразу.
  const [focusPick, setFocusPick] = useState(undefined)
  const leadGroup = lead?.kind === 'target' ? lead.item.group : null
  const focusGroup = focusPick === undefined ? leadGroup : focusPick
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
  const pickRegion = (r) => { setRegion((cur) => (cur === r ? null : r)); setSel(null); setFocusPick(null) }
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
          <Tip lead={lead} sex={data?.sex} onFocusGroup={focusOn} />

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
                    <i className={`fr-sw st-${x.status}`} aria-hidden="true" />
                    {labelOf(x.submuscle)}
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
