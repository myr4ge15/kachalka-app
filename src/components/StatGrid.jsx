import { fmtTonnage } from '../lib/profileStats.js'

// Быстрые цифры профиля «за всё время»: число тренировок + суммарный тоннаж
// (масштабируется в т/кг хелпером fmtTonnage). Презентационный — скользящие
// метрики (за месяц, серия) живут на Главной, здесь не дублируются.
export default function StatGrid({ totalWorkouts, tonnage }) {
  const t = fmtTonnage(tonnage)
  return (
    <div className="stat-grid">
      <div className="stat-cell">
        <div className="stat-num">{totalWorkouts}</div>
        <div className="stat-lab">тренировок<br />всего</div>
      </div>
      <div className="stat-cell">
        <div className="stat-num">{t.value}<span className="u"> {t.unit}</span></div>
        <div className="stat-lab">поднято<br />всего</div>
      </div>
    </div>
  )
}
