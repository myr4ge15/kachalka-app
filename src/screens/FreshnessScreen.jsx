import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getFreshness } from '../db/insights.js'
import { groupBuckets } from '../lib/freshness.js'
import { fmtDaysAgo, fmtDays } from '../lib/homeSummary.js'
import { labelOf, labelAccusativeOf } from '../lib/muscles.js'
import MuscleMap from '../components/MuscleMap.jsx'
import CardsSkeleton from '../components/CardsSkeleton.jsx'

// Детальный экран «Свежесть по группам» (виш BACKLOG, слайсы 2–3). Три
// представления над общим движком src/lib/freshness.js: heatmap-силуэт (MuscleMap,
// слайс 3), recovery-список «когда снова тренировать» (порог восстановления свой
// на группу) и анализ дисбаланса (канонические группы вне окна). Всё из локальных
// тренировок — офлайн-доступно, живо обновляется через useLiveQuery. Клик по зоне
// силуэта подсвечивает строку группы в recovery-списке (состояние sel).
//
// Пропсы: user, onBack().

const STATE_LABEL = { ready: 'можно', almost: 'почти', resting: 'дай отдых', never: '—' }
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export default function FreshnessScreen({ user, onBack }) {
  const data = useLiveQuery(() => getFreshness(user.id), [user.id])
  const loading = data === undefined
  // Силуэт — по крупным группам (major); recovery-список и дисбаланс — по подмышцам.
  const rec = data?.recovery ?? []
  const imb = data?.imbalance ?? []
  const recSub = data?.recoverySub ?? []
  const imbSub = data?.imbalanceSub ?? []
  const byGroup = groupBuckets(rec, imb)
  // Выбранная на силуэте группа (major) — подсвечивает строки её подмышц в списке.
  const [sel, setSel] = useState(null)
  const toggle = (g) => setSel((cur) => (cur === g ? null : g))

  return (
    <div className="screen fresh-screen">
      <div className="admin-head">
        <button className="admin-back" onClick={onBack}>‹ Назад</button>
        <h2 className="admin-title">Свежесть групп</h2>
      </div>

      {loading ? (
        <CardsSkeleton cards={4} />
      ) : recSub.length === 0 ? (
        <p className="muted empty">
          Запиши тренировку — покажу, какие мышцы отдохнули и пора ли их снова нагружать.
        </p>
      ) : (
        <>
          <section className="sec">
            <p className="sec-title">Карта тела</p>
            <MuscleMap byGroup={byGroup} selected={sel} onSelect={toggle} />
            <div className="fr-legend">
              <span><i className="fr-sw fr-fresh" />отдыхает</span>
              <span><i className="fr-sw fr-recent" />3–6 дн</span>
              <span><i className="fr-sw fr-due" />1–2 нед</span>
              <span><i className="fr-sw fr-overdue" />давно</span>
              <span><i className="fr-sw fr-never" />ни разу</span>
            </div>
          </section>

          <section className="sec">
            <p className="sec-title">Когда снова тренировать</p>
            <div className="fr-list">
              {recSub.map((f) => (
                <div
                  key={f.submuscle}
                  className={`fr-row fr-${f.bucket}` + (sel === f.major ? ' hl' : '')}
                >
                  <div className="fr-row-body">
                    <div className="fr-row-name">{cap(labelOf(f.submuscle))}</div>
                    <div className="fr-row-sub">{f.major} · {fmtDaysAgo(f.daysSince)}</div>
                  </div>
                  <span className={`fr-badge st-${f.state}`}>{STATE_LABEL[f.state] ?? '—'}</span>
                </div>
              ))}
            </div>
          </section>

          {imbSub.length > 0 && (
            <section className="sec">
              <p className="sec-title">Дисбаланс</p>
              <div className="fr-imb">
                <span className="em" aria-hidden="true">⚠️</span>
                <div className="fr-imb-body">
                  {imbSub.map((x) => (
                    <div key={x.submuscle} className="fr-imb-line">
                      {x.kind === 'never'
                        ? `${cap(labelOf(x.submuscle))} (${x.major}) — ни разу`
                        : `${cap(labelAccusativeOf(x.submuscle))} не тренировал уже ${fmtDays(x.daysSince)}`}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
