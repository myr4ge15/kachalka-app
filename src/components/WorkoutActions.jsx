import { useRevealFocus } from '../hooks/useRevealFocus.js'

// Блок действий композера тренировки: «очистить черновик» (только новая,
// когда есть состав; экран ставит блок сразу под датой), «⬇ экспорт в JSON»,
// «📋 сделать шаблон из тренировки» и
// «удалить тренировку» (только существующая) — каждый с in-app arm/confirm (единый
// паттерн приложения, без нативного confirm). Презентационный: состояние arm
// (clearArm/tplArm/delArm/tplName) и все эффекты (черновик/экспорт/шаблон/удаление)
// живут в WorkoutScreen, сюда приходят пропсами/колбэками.
export default function WorkoutActions({
  isNew, hasEntries, saving, tplBusy,
  clearArm, onArmClear, onCancelClear, onClearDraft,
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

  return (
    <>
      {isNew && hasEntries && (
        clearArm ? (
          <div className="danger-confirm" ref={armedRef}>
            <p className="danger-text">Очистить черновик? Добавленные упражнения будут удалены.</p>
            <div className="danger-actions">
              <button className="btn ghost" onClick={onCancelClear} disabled={saving}>Отмена</button>
              <button className="btn danger" onClick={onClearDraft} disabled={saving}>Да, очистить</button>
            </div>
          </div>
        ) : (
          <button className="link-btn danger full-link clear-draft" disabled={saving} onClick={onArmClear}>
            Очистить черновик
          </button>
        )
      )}

      {!isNew && (
        <button className="link-btn full-link" disabled={saving} onClick={onExport}>
          ⬇ Экспорт в JSON
        </button>
      )}

      {!isNew && (
        tplArm ? (
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
          <button className="link-btn full-link" disabled={saving} onClick={onOpenTpl}>
            📋 Сделать шаблон из тренировки
          </button>
        )
      )}

      {!isNew && (
        delArm ? (
          <div className="danger-confirm" ref={armedRef}>
            <p className="danger-text">Удалить эту тренировку? Действие необратимо.</p>
            <div className="danger-actions">
              <button className="btn ghost" onClick={onCancelDel} disabled={saving}>Отмена</button>
              <button className="btn danger" onClick={onDelete} disabled={saving}>
                {saving ? 'Удаляю…' : 'Да, удалить'}
              </button>
            </div>
          </div>
        ) : (
          <button className="link-btn danger full-link" disabled={saving} onClick={onArmDel}>
            Удалить тренировку
          </button>
        )
      )}
    </>
  )
}
