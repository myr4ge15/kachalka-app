import { fmtDate, toDateInput, fromDateInput } from '../lib/dates.js'

// Поле даты тренировки: подпись дд.мм.гггг + нативный <input type=date> (тап по
// всей области открывает пикер). Презентационное — значение и onChange(nextIso)
// приходят от WorkoutScreen. Дат-хелперы (формат/локальный день/сохранение
// времени суток) — чистые в lib/dates.
export default function DateField({ performedAt, onChange }) {
  return (
    <label className="date-field">
      <span className="muted">Дата</span>
      <span className="date-picker">
        <span className="date-picker__icon" aria-hidden="true">📅</span>
        <span className="date-picker__value">{fmtDate(performedAt)}</span>
        <span className="date-picker__chevron" aria-hidden="true">▾</span>
        <input
          type="date"
          value={toDateInput(performedAt)}
          onChange={(e) => onChange(fromDateInput(e.target.value, performedAt))}
        />
      </span>
    </label>
  )
}
