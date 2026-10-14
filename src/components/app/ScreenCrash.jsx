// Фолбэк пер-экранного ErrorBoundary (вынесено из App.jsx, v6.14.1).

// Компактный фолбэк пер-экранного ErrorBoundary: рухнул рендер одной вкладки.
// Живет внутри <main>, поэтому шапка и таббар остаются — можно уйти на другую
// вкладку (это сбросит ошибку через remount по key={tab}) или повторить рендер.
export default function ScreenCrash({ onRetry }) {
  return (
    <div className="screen center">
      <div className="card warn">
        <h2>Экран не открылся</h2>
        <p>
          Что-то пошло не так на этой вкладке. Данные тренировок сохранены
          локально — открой другую вкладку или попробуй снова.
        </p>
        <button className="btn primary" onClick={onRetry}>
          Попробовать снова
        </button>
      </div>
    </div>
  )
}
