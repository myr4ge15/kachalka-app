import { APP_VERSION } from '../../lib/appVersion.js'

// Версия приложения внизу Профиля и Настроек — подставляется на сборке из package.json
// (vite define). Название — ссылка на репозиторий проекта (открывается в новой вкладке).
export default function AppVersionLink() {
  return (
    <p className="app-version">
      <a
        className="repo-link"
        href="https://github.com/myr4ge15/kachalka-app"
        target="_blank"
        rel="noopener noreferrer"
      >
        kachalka-app
      </a>
      {' · '}v{APP_VERSION}
    </p>
  )
}
