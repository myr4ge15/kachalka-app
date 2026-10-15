import { useAliveRef } from '../../hooks/useAliveRef.js'
import { useState } from 'react'
import FeedbackScreenshotPicker from './FeedbackScreenshotPicker.jsx'
import { FEEDBACK_SHOTS_MAX } from '../../lib/feedback.js'
import { showToast } from '../ui/Toast.jsx'

export default function FeedbackAddScreenshots({ row, userId, api, online, onDone }) {
  const alive = useAliveRef()
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const remaining = FEEDBACK_SHOTS_MAX - (row.screenshot_count ?? (row.has_screenshot ? 1 : 0))
  if (remaining <= 0) return null
  async function send() {
    if (busy || !online || !files.length) return
    setBusy(true); setError('')
    try {
      const result = await api.attach(userId, row.id, files)
      if (!alive.current) return
      setFiles([])
      showToast({ emoji: '📎', title: 'Скриншоты добавлены', sub: result.delivered === false ? 'Сохранены, но доставка разработчику задержалась.' : '' })
      onDone()
    } catch (e) { if (alive.current) setError(e.message) }
    finally { if (alive.current) setBusy(false) }
  }
  return <div>
    <FeedbackScreenshotPicker files={files} onChange={setFiles} disabled={busy || !online} max={remaining} testId={'fb-file-' + row.id} />
    {files.length > 0 && <button type="button" className="btn ghost" onClick={send} disabled={busy || !online}>
      {busy ? 'Отправляю…' : 'Отправить скриншоты'}
    </button>}
    {error && <p role="alert" className="pin-err">{error}</p>}
  </div>
}
