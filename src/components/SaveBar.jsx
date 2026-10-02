import { plural } from '../lib/plural.js'

// Липкая кнопка «Сохранить» композера (fixed над таббаром, чтобы не уезжала вниз
// на длинной тренировке) + спейсер, позволяющий проскроллить последний элемент
// выше кнопки. Презентационная: состояние сохранения и обработчик — от WorkoutScreen.
//
// skippedSets — строки, которые в запись не попадут (нет повторов / нечисловой вес).
// Число на кнопке их не включает, а строка-предупреждение стоит в потоке над
// спейсером: так видно, ЧТО будет записано, до нажатия.
export default function SaveBar({ canSave, saving, totalSets, skippedSets = 0, onSave }) {
  return (
    <>
      {skippedSets > 0 && (
        <p className="wk-skip-note" role="status">
          {skippedSets} {plural(skippedSets, 'незаполненный подход', 'незаполненных подхода', 'незаполненных подходов')}{' '}
          не {plural(skippedSets, 'сохранится', 'сохранятся', 'сохранятся')} — впиши повторения или удали
        </p>
      )}
      {/* Место под липкий бар — последний элемент можно проскроллить выше кнопки. */}
      <div className="wk-save-spacer" aria-hidden="true" />
      <div className="wk-save-bar">
        <button className="btn primary full save-btn" disabled={!canSave} onClick={onSave}>
          {saving ? 'Сохранение…' : `Сохранить${totalSets ? ` (${totalSets})` : ''}`}
        </button>
      </div>
    </>
  )
}
