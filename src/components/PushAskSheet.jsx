import { useState } from 'react'
import SheetDialog from './SheetDialog.jsx'

// Разовый вопрос «Включить уведомления?» (v6.6.1). Показывает App один раз после
// входа, если включить можно одним нажатием (lib/pushSupport.js shouldAskPush).
// Системный запрос разрешения браузер покажет только в ответ на нажатие, поэтому
// сначала этот лист, а «Включить» уже зовет onEnable (db/push.js enablePush).
// Пропсы: onEnable() → Promise, onClose(enabled: boolean).
export default function PushAskSheet({ onEnable, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function enable() {
    setBusy(true)
    setError('')
    try {
      await onEnable?.()
      onClose?.(true)
    } catch (e) {
      setError(e?.message || 'Не получилось. Попробуй еще раз.')
      setBusy(false)
    }
  }

  return (
    <SheetDialog
      title="Уведомления"
      actionLabel="закрыть"
      onDismiss={() => onClose?.(false)}
      dismissDisabled={busy}
      className="sheet--compact"
    >
      <p className="push-ask-text">
        🔔 Сообщим, когда друзья отреагируют на твою тренировку или побьют твой рекорд, и напомним о зале, — даже если приложение закрыто.
      </p>
      {error && <p className="push-err" role="alert">{error}</p>}
      <button type="button" className="btn primary full" onClick={enable} disabled={busy} data-autofocus>
        {busy ? 'Включаю…' : 'Включить'}
      </button>
      <button type="button" className="link-btn push-ask-later" onClick={() => onClose?.(false)} disabled={busy}>
        Не сейчас
      </button>
      <p className="push-ask-hint">Что именно присылать — в Профиль → Настройки.</p>
    </SheetDialog>
  )
}
