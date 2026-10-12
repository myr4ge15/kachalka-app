import { fmtSetList, setColumns } from '../lib/metric.js'

// Подходы упражнения для списков (Лента, История, календарь, профиль друга,
// Прогресс, панель автопрогрессии). У «своего веса» с доп. весом/помощью —
// колонки «повторы над весом» (lib/metric.js setColumns, v7.2.3): колонки одной
// ширины, лишние уходят следующим рядом ровно под первым. Иначе — строка
// fmtSetList, как раньше. Презентационный, без состояния.
export default function SetsCells({ metric, sets, sep, empty = '—', align = 'end' }) {
  const cols = setColumns(metric, sets)
  if (!cols) return fmtSetList(metric, sets, sep) || empty
  return (
    <span className={`sets-cols sets-cols--${align}`} role="list" aria-label="Подходы: повторы и вес, кг">
      {cols.map((c, i) => (
        <span key={i} className="sets-col" role="listitem" aria-label={`${c.reps} повт., ${c.w} кг`}>
          <span className="sets-col-r">{c.reps}</span>
          <span className="sets-col-w">{c.w}</span>
        </span>
      ))}
    </span>
  )
}

// Подпись под названием упражнения, когда подходы показаны колонками: объясняет,
// где повторы, а где вес. Без колонок — ничего.
export function SetsCaption({ metric, sets }) {
  return setColumns(metric, sets) ? <small className="sets-caption">повт. · вес, кг</small> : null
}
