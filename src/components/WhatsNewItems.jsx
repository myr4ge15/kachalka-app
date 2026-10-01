// Пункты «Что нового» (v6.4.0) — общий список для листа после обновления и
// экрана «Обновления». Эмодзи — в плашке слева, текст — одна строка пользы.
export default function WhatsNewItems({ items, compact = false }) {
  return (
    <ul className={compact ? 'wn-list compact' : 'wn-list'}>
      {items.map((it, i) => (
        <li key={i}>
          <span className="wn-em" aria-hidden="true">{it.e}</span>
          <span>{it.t}</span>
        </li>
      ))}
    </ul>
  )
}
