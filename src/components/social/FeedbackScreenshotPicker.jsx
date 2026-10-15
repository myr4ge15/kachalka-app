import { useEffect, useRef, useState } from 'react'
import { FEEDBACK_SHOTS_MAX } from '../../lib/feedback.js'

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
    if (picked.some((f) => !f.type.startsWith('image/'))) { setError('Выбери изображения.'); return }
    if (files.length + picked.length > max) { setError('Можно добавить еще ' + Math.max(0, max - files.length) + ' скриншотов.'); return }
    setError(''); onChange([...files, ...picked])
  }
  return <>
    <div className="fb-picker">
      {files.map((file, n) => <div className="fb-shot" key={n}>
        <img src={urls[n]} alt={files.length === 1 ? 'Скриншот к обращению' : 'Скриншот к обращению ' + (n + 1)} />
        <button type="button" className="btn ghost" disabled={disabled}
          onClick={() => { setError(''); onChange(files.filter((_, i) => i !== n)) }}
          aria-label={files.length === 1 ? 'Убрать скриншот' : 'Убрать скриншот ' + (n + 1)}>Убрать</button>
      </div>)}
    </div>
    <button type="button" className="btn ghost fb-attach" disabled={disabled || files.length >= max}
      onClick={() => input.current?.click()}>📎 {files.length ? 'Добавить еще скриншоты' : 'Приложить скриншоты'}</button>
    <input ref={input} type="file" accept="image/*" multiple hidden disabled={disabled} onChange={pick} data-testid={testId} />
    {error && <p role="alert" className="pin-err">{error}</p>}
  </>
}
