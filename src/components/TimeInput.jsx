import { useState } from 'react'
import { fmtTime, parseTime } from '../lib/metric.js'

// Поле «мин:сек» (упражнения на время). Пока человек печатает, держим СЫРУЮ строку:
// раньше значение было `fmtTime(секунды)` и переформатировалось на каждое нажатие —
// стереть «1:00» было нельзя, а «1:30» поверх выделенного превращалось в «2:10»
// (РЕВЬЮ-КОДА-2026-10-02, п. 10). Наверх секунды уходят сразу (кнопка «Сохранить» и
// черновик видят актуальное число), а красиво форматируем на blur. Вне фокуса поле
// показывает значение от родителя — степперы «−/+» работают как раньше.
export default function TimeInput({ value, onChange, ...rest }) {
  const [raw, setRaw] = useState(null) // null — не в фокусе
  return (
    <input
      type="text" inputMode="numeric"
      {...rest}
      value={raw ?? fmtTime(value)}
      onFocus={(e) => { setRaw(fmtTime(value)); e.target.select?.() }}
      onChange={(e) => {
        // Двоеточие с телефонной цифровой клавиатуры часто недоступно — принимаем
        // точку, запятую и пробел как разделитель минут и секунд.
        const next = e.target.value.replace(/[.,\s]/g, ':').replace(/[^\d:]/g, '')
        setRaw(next)
        onChange(parseTime(next))
      }}
      onBlur={() => setRaw(null)}
    />
  )
}
