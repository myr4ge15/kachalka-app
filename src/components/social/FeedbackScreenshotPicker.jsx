import { useEffect, useRef, useState } from 'react'
import CheckIcon from '../ui/CheckIcon.jsx'
import { plural } from '../../lib/plural.js'
import { FEEDBACK_SHOTS_MAX, attachmentProblemText, fmtFileSize } from '../../lib/feedback.js'

// Вложения обращения: скриншоты и (16.10, fb_1c5fab9c) видео MP4/MOV до 50 МБ — всего до max.
// Предзагрузка (20.10.2026): файл грузится сразу после выбора (hooks/useAttachments.js), на
// миниатюре — кольцо прогресса, ✓ по готовности, «Повторить» при ошибке, крестик — убрать (и
// отменить загрузку). Видео — кадром, снятым приложением (lib/videoPoster.js): <video> на iPhone
// часто оставался черным квадратом.
// Пропсы: items (из useAttachments), onAdd(files), onRemove(key), onRetry(key), disabled, max, testId.
export default function FeedbackScreenshotPicker({ items, onAdd, onRemove, onRetry, disabled, max = FEEDBACK_SHOTS_MAX, testId = 'fb-file' }) {
  const input = useRef(null)
  const [error, setError] = useState('')
  const urls = useImageUrls(items)
  function pick(e) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    const bad = picked.map(attachmentProblemText).find(Boolean)
    if (bad) { setError(bad); return }
    // Больше, чем влезает (fb_9e79f821: выбрали 6 — не добавлялось ни одного): берем первые, что влезают.
    const room = Math.max(0, max - items.length)
    const fit = picked.slice(0, room)
    setError(picked.length > room
      ? `Добавлено ${fit.length} из ${picked.length}: всего можно ${max} ${plural(max, 'вложение', 'вложения', 'вложений')}.`
      : '')
    if (fit.length) onAdd(fit)
  }
  const one = items.length === 1
  return <>
    <div className="fb-picker">
      {items.map((it, n) => {
        const name = one ? '' : ' ' + (n + 1)
        // 100 % байтов — еще не готово (сервер дописывает): кольцо крутится без цифр (fb_8e7257c6).
        const raw = it.total > 0 ? Math.min(100, Math.round((it.loaded / it.total) * 100)) : null
        const pct = raw != null && raw < 100 ? raw : null
        return <div className={`fb-shot is-${it.status}`} key={it.key}>
          {it.video
            ? <div className="fb-shot-video">
              {it.poster
                ? <img src={it.poster} alt={'Видео к обращению' + name} />
                : <div className="fb-shot-plate" role="img" aria-label={'Видео к обращению' + name}>▶</div>}
              <span className="fb-shot-tag">▶ Видео{it.file?.size ? ' · ' + fmtFileSize(it.file.size) : ''}</span>
            </div>
            : <img src={urls[it.key]} alt={'Скриншот к обращению' + name} />}
          {it.status === 'uploading' && (
            <div className="fb-shot-state" role="status" aria-label={'Загружается' + name + (pct != null && it.video ? `: ${pct}%` : '')}>
              <Ring pct={it.video ? pct : null} />
              {it.video && pct != null && <span className="fb-shot-pct">{pct}%</span>}
            </div>
          )}
          {it.status === 'done' && <span className="fb-shot-ok" role="img" aria-label={'Загружено' + name}><CheckIcon size={14} strokeWidth={3} /></span>}
          {it.status === 'error' && (
            <button type="button" className="fb-shot-state fb-shot-retry" onClick={() => onRetry(it.key)} disabled={disabled}
              aria-label={'Повторить загрузку' + name} title={it.error}>
              ↻<span>Повторить</span>
            </button>
          )}
          {/* Крестик в углу миниатюры (fb_7e661cff): убрать, а идущую загрузку — отменить. */}
          <button type="button" className="fb-shot-rm" disabled={disabled}
            onClick={() => { setError(''); onRemove(it.key) }}
            aria-label={'Убрать скриншот' + name}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6"
              strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      })}
    </div>
    <button type="button" className="btn ghost fb-attach" disabled={disabled || items.length >= max}
      onClick={() => input.current?.click()}>📎 {items.length ? 'Добавить еще' : 'Приложить скриншоты или видео'}</button>
    <input ref={input} type="file" accept="image/*,video/mp4,video/quicktime" multiple hidden disabled={disabled} onChange={pick} data-testid={testId} />
    {/* fb_37f0c1a8: свернутое приложение iPhone замораживает — файл начнет грузиться заново после возврата. */}
    {items.some((it) => it.status === 'uploading') && (
      <p className="muted fb-upload-hint">Не сворачивай приложение, пока идет загрузка, — иначе файл начнет грузиться заново.</p>
    )}
    {error && <p role="alert" className="pin-err">{error}</p>}
  </>
}

// Кольцо загрузки: доля (pct) — заливкой по кругу; без доли (картинка: сжатие + загрузка) — бегущее.
function Ring({ pct }) {
  const r = 24, c = 2 * Math.PI * r
  return (
    <svg className={'fb-ring' + (pct == null ? ' spin' : '')} viewBox="0 0 56 56" width="56" height="56" aria-hidden="true">
      <circle className="fb-ring-track" cx="28" cy="28" r={r} />
      <circle className="fb-ring-arc" cx="28" cy="28" r={r} strokeDasharray={c.toFixed(1)}
        strokeDashoffset={(pct == null ? c * 0.7 : c * (1 - pct / 100)).toFixed(1)} />
    </svg>
  )
}

// Ссылки на картинки по ключу элемента: создаем один раз на файл, освобождаем, когда его убрали
// и при уходе с экрана (ref — cleanup размонтирования setState уже не выполнит).
function useImageUrls(items) {
  const [urls, setUrls] = useState({})
  const ref = useRef(urls)
  useEffect(() => {
    const cur = ref.current
    const next = {}
    for (const it of items) if (!it.video) next[it.key] = cur[it.key] ?? URL.createObjectURL(it.file)
    for (const [k, u] of Object.entries(cur)) if (!(k in next)) URL.revokeObjectURL(u)
    ref.current = next
    setUrls(next)
  }, [items])
  useEffect(() => () => { Object.values(ref.current).forEach((u) => URL.revokeObjectURL(u)); ref.current = {} }, [])
  return urls
}
