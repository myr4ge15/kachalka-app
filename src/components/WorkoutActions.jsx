import { useRevealFocus } from '../hooks/useRevealFocus.js'

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
  tplArm, onOpenTpl, onCancelTpl, tplName, onTplName, onMakeTemplate,
  delArm, onArmDel, onCancelDel, onDelete,
}) {
  // Раскрытое подтверждение центрируем в скроллере (общий инвариант раскрытий,
  // hooks/useRevealFocus). Иначе ссылка ~30px превращается в блок ~120px, и его
  // нижний край с кнопками уезжает под липкую «Сохранить» (.wk-save-bar, fixed на
  // bottom:72px): резерва .wk-save-spacer в 76px на это не хватает. Для «очистить
  // черновик» экран решает ту же задачу композицией (блок стоит сверху), но у
  // «удалить тренировку» и «сделать шаблон» такого обхода нет.
  const armed = delArm ? 'del' : tplArm ? 'tpl' : clearArm ? 'clear' : null
  const armedRef = useRevealFocus(armed)

  const confirm = (text, onCancel, onOk, okLabel, busy) => (
    <div className="danger-confirm" ref={armedRef}>
      <p className="danger-text">{text}</p>
      <div className="danger-actions">
        <button className="btn ghost" onClick={onCancel} disabled={busy}>Отмена</button>
        <button className="btn danger" onClick={onOk} disabled={busy}>{okLabel}</button>
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
      <button className="wk-act" disabled={saving} onClick={onExport}>
        <ActIcon name="export" />Экспорт в JSON
      </button>

      {tplArm ? (
        <div className="tpl-from-wk" ref={armedRef}>
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
            <button className="btn ghost" onClick={onCancelTpl} disabled={tplBusy}>Отмена</button>
            <button className="btn primary" onClick={onMakeTemplate} disabled={tplBusy || !tplName.trim()}>
              {tplBusy ? 'Создаю…' : 'Создать шаблон'}
            </button>
          </div>
        </div>
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
  if (name === 'template') return <svg {...p}><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4V3h6v1M9 10h6M9 14h6" /></svg>
  return <svg {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" /></svg>
}
