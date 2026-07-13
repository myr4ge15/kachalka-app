import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import UpdatePrompt from './components/UpdatePrompt.jsx'
import { openUserDb } from './db/local.js' // Проверьте, что этот путь верный для вашего проекта
import './index.css'

// ===== РАННЯЯ ИНИЦИАЛИЗАЦИЯ (до рендера React) =====
const rawSession = localStorage.getItem('gym_app_user')

if (rawSession) {
  const userId = rawSession // Берем значение как есть

  // 1. Начинаем открывать БД параллельно с загрузкой React
  openUserDb(userId).catch(() => {
    // Ошибку игнорируем, App.jsx подхватит и обработает штатно
  })

  // 2. Мгновенно начинаем грузить JS-чанк главной страницы в фоне
  import('./screens/HomeScreen.jsx').catch(() => {})
}
// =====================================================

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <UpdatePrompt />
  </React.StrictMode>
)