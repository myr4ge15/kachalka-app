// Пустое состояние с подсказкой (v6.15.0): новичок видит не «пусто», а что здесь
// появится и что сделать первым. Значок, заголовок, пояснение и (по желанию)
// список «что появится». Кнопку действия экран ставит сам — под подсказкой.
// Пропсы: emoji, title, children (пояснение), items?: [{ e, t }].
export default function EmptyHint({ emoji, title, children, items }) {
  return (
    <div className="empty-hint">
      <span className="empty-hint-em" aria-hidden="true">{emoji}</span>
      <p className="empty-hint-title">{title}</p>
      {children && <p className="empty-hint-text">{children}</p>}
      {items?.length > 0 && (
        <ul className="empty-hint-list">
          {items.map((it) => (
            <li key={it.t}>
              <span className="wn-em" aria-hidden="true">{it.e}</span>
              <span>{it.t}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
