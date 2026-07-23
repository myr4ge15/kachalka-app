// Липкая кнопка «Сохранить» композера (fixed над таббаром, чтобы не уезжала вниз
// на длинной тренировке) + спейсер, позволяющий проскроллить последний элемент
// выше кнопки. Презентационная: состояние сохранения и обработчик — от WorkoutScreen.
export default function SaveBar({ canSave, saving, totalSets, onSave }) {
  return (
    <>
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
