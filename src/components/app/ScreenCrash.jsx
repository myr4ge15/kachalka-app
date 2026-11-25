// Фолбэк пер-экранного ErrorBoundary (вынесено из App.jsx, v6.14.1).

// Компактный фолбэк пер-экранного ErrorBoundary: рухнул рендер одной вкладки.
// Живет внутри <main>, поэтому шапка и таббар остаются — можно уйти на другую
// вкладку (это сбросит ошибку через remount по key={tab}) или повторить рендер.
import { reloadForUpdatePush } from '../../lib/launchUpdate.js'

export default function ScreenCrash({ error, onRetry }) {
  const moduleFailed = /MIME type for module script|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(error?.message)
  async function retryModule() {
    const result = await reloadForUpdatePush({ versionUrl: import.meta.env.BASE_URL + 'version.json', currentVersion: __APP_VERSION__ })
    // React.lazy кэширует отклонённый промис на всё время жизни страницы.
    if (result === 'none') window.location.reload()
  }
  return (
    <div className="screen center">
      <div className="card warn">
        <h2>Экран не открылся</h2>
        <p>
          {moduleFailed ? 'Не удалось загрузить файлы экрана. Подключись к сети и перезагрузи приложение. Черновик сохранён на устройстве.' :
            'Что-то пошло не так на этой вкладке. Данные тренировок сохранены локально — открой другую вкладку или попробуй снова.'}
        </p>
        <button className="btn primary" onClick={moduleFailed ? retryModule : onRetry}>
          {moduleFailed ? 'Перезагрузить приложение' : 'Попробовать снова'}
        </button>
      </div>
    </div>
  )
}
