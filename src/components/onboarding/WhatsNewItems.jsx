// Пункты «Что нового» (v6.4.0) — общий список для листа после обновления и
// экрана «Обновления». Эмодзи — в плашке слева, текст — одна строка пользы.
// v8.0.0: у пункта могут быть уточнения `sub` (строки) — вложенный список с
// отступом под ним: детали одной фичи держатся вместе, а не разбросаны по мелочам.
export default function WhatsNewItems({ items, compact = false }) {
  return (
    <ul className={compact ? 'wn-list compact' : 'wn-list'}>
      {items.map((it, i) => (
        <li key={i}>
          <span className="wn-em" aria-hidden="true">{it.e}</span>
          <div className="wn-body">
            <span>{it.t}</span>
            {it.sub?.length > 0 && (
              <ul className="wn-sub">
                {it.sub.map((s, j) => <li key={j}>{s}</li>)}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
