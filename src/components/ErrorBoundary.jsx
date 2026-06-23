import { Component } from 'react'

// Ловит исключения в рендере дочерних компонентов, чтобы ошибка на одном
// экране не гасила всё приложение (белый экран). Показывает простой фолбэк
// с возможностью перезагрузить.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Логируем для диагностики; продакшен-логгера пока нет.
    console.error('Перехвачено ErrorBoundary:', error, info)
  }

  render() {
    if (this.state.error) {
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
