import { useRegisterSW } from 'virtual:pwa-register/react'

// Баннер обновления PWA. При registerType:'prompt' service worker скачивает
// новую версию в фоне, но НЕ применяет её сам — показываем плашку, и обновление
// происходит в один тап (updateServiceWorker(true) активирует SW и перезагружает).
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="update-banner" role="alert">
      <span className="update-banner-text">Доступна новая версия</span>
      <div className="update-banner-actions">
        <button className="btn primary" onClick={() => updateServiceWorker(true)}>
          Обновить
        </button>
        <button className="link-btn" onClick={() => setNeedRefresh(false)}>
          Позже
        </button>
      </div>
    </div>
  )
}
