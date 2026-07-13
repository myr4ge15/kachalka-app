// Панель экспорта списка: приглушённая ссылка «⬇ <label>» внизу вне режима
// выбора; фиксированный бар над таббаром (счётчик + Все/Отмена/Скачать) в режиме
// выбора. Общая для Истории и Шаблонов (РЕВЬЮ-КОДА-2026-07-13). Разметка/классы —
// как раньше в обоих экранах (export-toggle / export-bar--fixed).
export default function ExportBar({
  selectMode, count = 0, label, canShow = true,
  onToggleMode, onPickAll, onExport,
}) {
  if (!selectMode) {
    if (!canShow) return null
    return (
      <button className="link-btn export-toggle export-toggle--bottom" onClick={onToggleMode}>
        ⬇ {label}
      </button>
    )
  }
  return (
    <>
      <div className="wk-save-spacer" aria-hidden="true" />
      <div className="export-bar export-bar--fixed">
        <span className="muted">Выбрано: {count}</span>
        <div className="export-bar-actions">
          <button className="link-btn" onClick={onPickAll}>Все</button>
          <button className="link-btn" onClick={onToggleMode}>Отмена</button>
          <button className="btn primary" disabled={count === 0} onClick={onExport}>
            ⬇ Скачать{count ? ` (${count})` : ''}
          </button>
        </div>
      </div>
    </>
  )
}
