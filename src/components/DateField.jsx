import { fmtDayChip, toDateInput, fromDateInput } from '../lib/dates.js'

// Дата тренировки — чип под заголовком композера (v6.1.0, редизайн «Спорт-блоки»):
// «Сегодня, 30 сентября» + нативный <input type=date> поверх (тап по чипу открывает
// пикер). С него же начинается запись задним числом. Презентационное — значение и
// onChange(nextIso) приходят от WorkoutScreen. Дат-хелперы — чистые в lib/dates.
export default function DateField({ performedAt, onChange }) {
  const current = toDateInput(performedAt)
  // Пусто (сброс) → сегодня. Ту же дату повторно не шлем: blur после обычного выбора
  // не должен дергать onChange второй раз.
  // Будущую дату не принимаем (max у поля + страховка здесь: не все браузеры
  // соблюдают max при ручном вводе). Тренировка «из будущего» ломала не только
  // статистику: метка «уведомления прочитаны» уезжала в ее дату и глушила
  // колокольчик на всех устройствах.
  const today = toDateInput()
  function apply(raw) {
    let day = raw || today
    if (day > today) day = today
    if (day === current) return
    onChange(fromDateInput(day, performedAt))
  }
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
        // required (v6.3.8): у даты тренировки не бывает «пусто», и с этим атрибутом iOS
        // не показывает в пикере кнопку «Сбросить» (она очищала поле, а приложение об этом
        // не узнавало). Формы тут нет — на отправку не влияет.
        required
        max={today}
        value={current}
        // «Сбросить» в пикере iOS очищает значение — а кружок уже стоит на сегодня.
        // v6.3.5: пустое значение в change → сегодня. v6.3.6: iOS не всегда шлет change
        // на сброс (кружок вернулся, а чип остался на старой дате) — поэтому еще
        // сверка при закрытии пикера (blur): что в поле, то и в дате.
        onChange={(e) => apply(e.target.value)}
        onBlur={(e) => apply(e.target.value)}
      />
    </label>
  )
}
