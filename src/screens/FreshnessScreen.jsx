import { useLiveQuery } from 'dexie-react-hooks'
import { getFreshness } from '../db/insights.js'
import { fmtDaysAgo, fmtDays } from '../lib/homeSummary.js'
import { groupAccusative } from '../lib/dayTags.js'

// Детальный экран «Свежесть по группам» (виш BACKLOG, слайс 2). Два текстовых
// представления над общим движком src/lib/freshness.js: recovery-список «когда
// снова тренировать» (порог восстановления свой на группу) и анализ дисбаланса
// (канонические группы вне окна). Всё из локальных тренировок — офлайн-доступно,
// живо обновляется через useLiveQuery. Heatmap-силуэт — отдельный слайс 3.
//
// Пропсы: user, onBack().

const STATE_LABEL = { ready: 'можно', almost: 'почти', resting: 'дай отдых', never: '—' }
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export default function FreshnessScreen({ user, onBack }) {
  const data = useLiveQuery(() => getFreshness(user.id), [user.id])
  const loading = data === undefined
  const rec = data?.recovery ?? []
  const imb = data?.imbalance ?? []

  return (
    <div className="screen fresh-screen">
      <div className="admin-head">
        <button className="admin-back" onClick={onBack}>‹ Назад</button>
        <h2 className="admin-title">Свежесть групп</h2>
      </div>

      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : rec.length === 0 ? (
        <p className="muted empty">
          Запиши тренировку — покажу, какие группы отдохнули и пора ли их снова нагружать.
        </p>
      ) : (
        <>
          <section className="sec">
            <p className="sec-title">Когда снова тренировать</p>
            <div className="fr-list">
              {rec.map((f) => (
                <div key={f.group} className={`fr-row fr-${f.bucket}`}>
                  <div className="fr-row-body">
                    <div className="fr-row-name">{cap(f.group)}</div>
                    <div className="fr-row-sub">{fmtDaysAgo(f.daysSince)}</div>
                  </div>
                  <span className={`fr-badge st-${f.state}`}>{STATE_LABEL[f.state] ?? '—'}</span>
                </div>
              ))}
            </div>
          </section>

          {imb.length > 0 && (
            <section className="sec">
              <p className="sec-title">Дисбаланс</p>
              <div className="fr-imb">
                <span className="em" aria-hidden="true">⚠️</span>
                <div className="fr-imb-body">
                  {imb.map((x) => (
                    <div key={x.group} className="fr-imb-line">
                      {x.kind === 'never'
                        ? `${cap(x.group)} — ни разу`
                        : `${cap(groupAccusative(x.group))} не тренировал уже ${fmtDays(x.daysSince)}`}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          <p className="fr-note muted">
            Скоро здесь появится карта тела с раскраской по свежести.
          </p>
        </>
      )}
    </div>
  )
}
