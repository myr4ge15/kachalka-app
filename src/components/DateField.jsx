import { fmtDayChip, toDateInput, fromDateInput } from '../lib/dates.js'

// Дата тренировки — чип под заголовком композера (v6.1.0, редизайн «Спорт-блоки»):
// «Сегодня, 30 сентября» + нативный <input type=date> поверх (тап по чипу открывает
// пикер). С него же начинается запись задним числом. Презентационное — значение и
// onChange(nextIso) приходят от WorkoutScreen. Дат-хелперы — чистые в lib/dates.
export default function DateField({ performedAt, onChange }) {
  return (
    <label className="date-chip">
      <svg className="date-chip__ico" viewBox="0 0 24 24" width="15" height="15" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
      <span className="date-chip__value">{fmtDayChip(performedAt)}</span>
      <input
        type="date"
        aria-label="Дата тренировки"
        value={toDateInput(performedAt)}
        // «Сбросить» в пикере iOS присылает пустое значение — а колесо уже стоит на сегодня.
        // Раньше пустое игнорировали и дата не менялась (v6.3.5): теперь сброс = сегодня.
        onChange={(e) => onChange(fromDateInput(e.target.value || toDateInput(), performedAt))}
      />
    </label>
  )
}
