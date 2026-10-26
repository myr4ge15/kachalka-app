// Панель экспорта списка: приглушенная ссылка «<иконка> <label>» внизу вне режима
// выбора; фиксированный бар над таббаром (счетчик + Все/Отмена/Скачать) в режиме
// выбора. Иконка — DownloadIcon, не символ «⬇» (на iPhone — синий эмодзи, fb_3830b581).
// Общая для Истории и Шаблонов (РЕВЬЮ-КОДА-2026-07-13). Разметка/классы —
// как раньше в обоих экранах (export-toggle / export-bar--fixed).
// Резерв под фиксированный бар (.wk-save-spacer) — только при placement 'bottom': у кнопки
// наверху (Шаблоны) он вставал над списком пустым местом (fb_f0dfa756, 19.10.2026) — там
// экран сам ставит резерв в конец списка.
import DownloadIcon from '../ui/DownloadIcon.jsx'

export default function ExportBar({
  selectMode, count = 0, label, canShow = true, placement = 'bottom',
  onToggleMode, onPickAll, onExport,
}) {
  if (!selectMode) {
    if (!canShow) return null
    return (
      <button className={`link-btn export-toggle export-toggle--${placement}`} onClick={onToggleMode}>
        <DownloadIcon className="export-ico" /> {label}
      </button>
    )
  }
  return (
    <>
      {placement === 'bottom' && <div className="wk-save-spacer" aria-hidden="true" />}
      <div className="export-bar export-bar--fixed">
        <span className="muted">Выбрано: {count}</span>
        <div className="export-bar-actions">
          <button className="link-btn" onClick={onPickAll}>Все</button>
          <button className="link-btn" onClick={onToggleMode}>Отмена</button>
          <button className="btn primary" disabled={count === 0} onClick={onExport}>
            <DownloadIcon className="export-ico" /> Скачать{count ? ` (${count})` : ''}
          </button>
        </div>
      </div>
    </>
  )
}
