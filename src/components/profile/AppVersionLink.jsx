import { APP_VERSION } from '../../lib/appVersion.js'

// Версия приложения внизу Профиля и Настроек — подставляется на сборке из package.json
// (vite define). Ссылку на репозиторий убрали (fb_3bbeb92f, 27.10.2026): друзьям она ни к чему,
// а в PWA на iPhone уводила из приложения в браузер.
export default function AppVersionLink() {
  return (
    <p className="app-version">
      kachalka-app · <span className="version-number">v{APP_VERSION}</span>
    </p>
  )
}
