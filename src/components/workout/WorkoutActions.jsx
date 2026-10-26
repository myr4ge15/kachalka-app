import { useRevealFocus } from '../../hooks/useRevealFocus.js'

// Блок действий композера тренировки: подтверждение «очистить черновик» (только
// новая; сама кнопка «Очистить» с v6.1.0 — в шапке экрана, здесь только раскрытое
// подтверждение, экран ставит блок сразу под шапкой), «Экспорт в JSON»,
// «Сделать шаблон из тренировки» и «Удалить тренировку» (только существующая,
// списком строк внизу) — каждый с in-app arm/confirm (единый паттерн приложения,
// без нативного confirm). Презентационный: состояние arm
// (clearArm/tplArm/delArm/tplName) и все эффекты (черновик/экспорт/шаблон/удаление)
// живут в WorkoutScreen, сюда приходят пропсами/колбэками.
export default function WorkoutActions({
  isNew, hasEntries, saving, tplBusy,
  clearArm, onCancelClear, onClearDraft,
  onExport,
  canCopy = false, copyArm = false, onCopy, onConfirmCopy, onCancelCopy,
  tplArm, onOpenTpl, onCancelTpl, tplName, onTplName, onMakeTemplate,
  delArm, onArmDel, onCancelDel, onDelete,
}) {
  // Раскрытое подтверждение центрируем в скроллере (общий инвариант раскрытий,
  // hooks/useRevealFocus). Иначе ссылка ~30px превращается в блок ~120px, и его
  // нижний край с кнопками уезжает под липкую «Сохранить» (.wk-save-bar, fixed на
  // bottom:72px): резерва .wk-save-spacer в 76px на это не хватает. Для «очистить
  // черновик» экран решает ту же задачу композицией (блок стоит сверху), но у
  // «удалить тренировку» и «сделать шаблон» такого обхода нет.
  const armed = delArm ? 'del' : tplArm ? 'tpl' : clearArm ? 'clear' : copyArm ? 'copy' : null
  const armedRef = useRevealFocus(armed)

  const confirm = (text, onCancel, onOk, okLabel, busy, okClass = 'danger') => (
    <div className="danger-confirm" ref={armedRef}>
      <p className="danger-text">{text}</p>
      <div className="danger-actions">
        <button className="btn ghost" onClick={onCancel} disabled={busy}>Отмена</button>
        <button className={`btn ${okClass}`} onClick={onOk} disabled={busy}>{okLabel}</button>
      </div>
    </div>
  )

  if (isNew) {
    return hasEntries && clearArm
      ? confirm('Очистить черновик? Добавленные упражнения будут удалены.', onCancelClear, onClearDraft, 'Да, очистить', saving)
      : null
  }

  return (
    <div className="wk-acts">
      {/* «Копировать тренировку» (26.10.2026) — первой: тот же состав новой тренировкой на сегодня. */}
      {canCopy && (copyArm
        ? confirm('В новой тренировке уже есть упражнения. Заменить их этой тренировкой?', onCancelCopy, onConfirmCopy,
          'Да, заменить', saving, 'primary')
        : (
          <button className="wk-act" disabled={saving} onClick={onCopy}>
            <ActIcon name="copy" />Копировать тренировку
          </button>
        ))}
      <button className="wk-act" disabled={saving} onClick={onExport}>
        <ActIcon name="export" />Экспорт в JSON
      </button>

      {tplArm ? (
        // <form>: Enter («Готово») на клавиатуре iPhone создает шаблон (UI-ревью 23.10).
        <form className="tpl-from-wk" ref={armedRef}
          onSubmit={(e) => { e.preventDefault(); if (!tplBusy && tplName.trim()) onMakeTemplate() }}>
          <label className="tpl-name-field">
            <span className="muted">Название шаблона</span>
            <input
              className="search"
              value={tplName}
              onChange={(e) => onTplName(e.target.value)}
              placeholder="Название шаблона"
              autoFocus
            />
          </label>
          <div className="danger-actions">
            <button type="button" className="btn ghost" onClick={onCancelTpl} disabled={tplBusy}>Отмена</button>
            <button type="submit" className="btn primary" disabled={tplBusy || !tplName.trim()}>
              {tplBusy ? 'Создаю…' : 'Создать шаблон'}
            </button>
          </div>
        </form>
      ) : (
        <button className="wk-act" disabled={saving} onClick={onOpenTpl}>
          <ActIcon name="template" />Сделать шаблон из тренировки
        </button>
      )}

      {delArm
        ? confirm('Удалить эту тренировку? Действие необратимо.', onCancelDel, onDelete, saving ? 'Удаляю…' : 'Да, удалить', saving)
        : (
          <button className="wk-act danger" disabled={saving} onClick={onArmDel}>
            <ActIcon name="trash" />Удалить тренировку
          </button>
        )}
    </div>
  )
}

// Иконки строк действий — инлайн-SVG (как TabIcon), красятся currentColor.
function ActIcon({ name }) {
  const p = {
    className: 'wk-act-ico', viewBox: '0 0 24 24', width: 19, height: 19, fill: 'none',
    stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
  }
  if (name === 'export') return <svg {...p}><path d="M12 3v12M7 8l5-5 5 5M5 21h14" /></svg>
  if (name === 'copy') return <svg {...p}><rect x="8" y="8" width="12" height="13" rx="2.5" /><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-7A2.5 2.5 0 0 0 4 5.5v9A2.5 2.5 0 0 0 6.5 17H8" /></svg>
  if (name === 'template') return <svg {...p}><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4V3h6v1M9 10h6M9 14h6" /></svg>
  return <svg {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" /></svg>
}
