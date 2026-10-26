import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import MenuRow from '../ui/MenuRow.jsx'

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

  // Действия — одной сгруппированной плашкой под заголовком (26.10.2026): отдельными карточками
  // они сливались с карточками упражнений над ними.
  return (
    <section className="wk-acts" aria-labelledby="wk-acts-title">
      <p className="sec-title wk-acts-title" id="wk-acts-title">Действия с тренировкой</p>
      <div className="menu-group">
      {/* «Копировать тренировку» (26.10.2026) — первой: тот же состав новой тренировкой на сегодня. */}
      {canCopy && (copyArm
        ? confirm('В новой тренировке уже есть упражнения. Заменить их этой тренировкой?', onCancelCopy, onConfirmCopy,
          'Да, заменить', saving, 'primary')
        : (
          <MenuRow kind="action" icon="copy" title="Копировать тренировку" disabled={saving} onClick={onCopy} />
        ))}
      <MenuRow kind="action" icon="download" title="Экспорт в JSON" disabled={saving} onClick={onExport} />

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
        <MenuRow kind="action" icon="template" title="Сделать шаблон из тренировки" disabled={saving} onClick={onOpenTpl} />
      )}

      {delArm
        ? confirm('Удалить эту тренировку? Действие необратимо.', onCancelDel, onDelete, saving ? 'Удаляю…' : 'Да, удалить', saving)
        : (
          <MenuRow kind="action" tone="danger" icon="trash" title="Удалить тренировку" disabled={saving} onClick={onArmDel} />
        )}
      </div>
    </section>
  )
}
