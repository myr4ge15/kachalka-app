import { useEffect, useRef, useState } from 'react'
import { FEEDBACK_SHOTS_MAX, attachmentProblem, feedbackErrorText, isVideoFile } from '../../lib/feedback.js'

// Вложения обращения: скриншоты и (16.10, fb_1c5fab9c) видео MP4/MOV до 20 МБ — всего до max.

export default function FeedbackScreenshotPicker({ files, onChange, disabled, max = FEEDBACK_SHOTS_MAX, testId = 'fb-file' }) {
  const input = useRef(null)
  const [urls, setUrls] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    const next = files.map((file) => URL.createObjectURL(file))
    setUrls(next)
    return () => next.forEach((url) => URL.revokeObjectURL(url))
  }, [files])
  function pick(e) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    const bad = picked.map(attachmentProblem).find(Boolean)
    if (bad) { setError(feedbackErrorText(bad)); return }
    if (files.length + picked.length > max) { setError('Можно добавить еще ' + Math.max(0, max - files.length) + ' вложений.'); return }
    setError(''); onChange([...files, ...picked])
  }
  return <>
    <div className="fb-picker">
      {files.map((file, n) => <div className="fb-shot" key={n}>
        {isVideoFile(file)
          ? <video src={urls[n]} muted playsInline preload="metadata"
            aria-label={files.length === 1 ? 'Видео к обращению' : 'Видео к обращению ' + (n + 1)} />
          : <img src={urls[n]} alt={files.length === 1 ? 'Скриншот к обращению' : 'Скриншот к обращению ' + (n + 1)} />}
        <button type="button" className="btn ghost" disabled={disabled}
          onClick={() => { setError(''); onChange(files.filter((_, i) => i !== n)) }}
          aria-label={files.length === 1 ? 'Убрать скриншот' : 'Убрать скриншот ' + (n + 1)}>Убрать</button>
      </div>)}
    </div>
    <button type="button" className="btn ghost fb-attach" disabled={disabled || files.length >= max}
      onClick={() => input.current?.click()}>📎 {files.length ? 'Добавить еще' : 'Приложить скриншоты или видео'}</button>
    <input ref={input} type="file" accept="image/*,video/mp4,video/quicktime" multiple hidden disabled={disabled} onChange={pick} data-testid={testId} />
    {error && <p role="alert" className="pin-err">{error}</p>}
  </>
}
