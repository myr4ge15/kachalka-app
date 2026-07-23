import { Component } from 'react'

// Ловит исключения в рендере дочерних компонентов, чтобы ошибка не гасила всё
// приложение (белый экран). Два режима работы:
//   • корневой (main.jsx) — без пропа `fallback`: фолбэк по умолчанию на весь
//     экран с кнопкой перезагрузки (последний рубеж, если рухнула сама оболочка);
//   • пер-экранный (App.jsx, внутри <main>) — с пропом `fallback`: падение
//     одной вкладки НЕ роняет шапку/таббар (они вне <main>), пользователь может
//     уйти на другую вкладку или повторить. `fallback` — функция
//     (error, reset) => node; `reset` очищает ошибку (повторный рендер).
// Пер-экранный боундари живёт внутри `key={tab}`-обёртки в App: смена вкладки
// его размонтирует → ошибка сбрасывается сама, отдельная логика не нужна.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
    this.reset = this.reset.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Логируем для диагностики; продакшен-логгера пока нет.
    console.error('Перехвачено ErrorBoundary:', error, info)
  }

  reset() {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      const { fallback } = this.props
      if (typeof fallback === 'function') return fallback(this.state.error, this.reset)
      if (fallback) return fallback
      return (
        <div className="screen center">
          <div className="card warn">
            <h2>Что-то пошло не так</h2>
            <p>Произошла ошибка в приложении. Данные тренировок сохранены локально.</p>
            <button className="btn primary" onClick={() => window.location.reload()}>
              Перезагрузить
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
