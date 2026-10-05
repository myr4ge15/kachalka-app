import { useEffect, useRef, useState } from 'react'
import BackButton from '../components/BackButton.jsx'
import CardsSkeleton from '../components/CardsSkeleton.jsx'
import { showToast } from '../components/Toast.jsx'
import { useSyncStatus } from '../db/sync.js'
import {
  bodyProblem, buildContext, fmtFeedbackDate, hasUnreadReply, FEEDBACK_MAX, STATUS_LABEL,
} from '../lib/feedback.js'
import {
  ackMyFeedback, listMyFeedback, submitFeedback as defaultSubmit, FeedbackError,
} from '../lib/feedbackApi.js'

const defaultApi = { submit: defaultSubmit, list: listMyFeedback, ack: ackMyFeedback }

// «Написать разработчику» (v6.11.0, Профиль → Настройки). Обращение уходит
// разработчику в Telegram; ответ и статус видны здесь и приходят пушем
// (tag feedback-<id> открывает этот экран и подсвечивает обращение).
// Пропсы: user, onBack(), [focusId] — id из пуша, [api] — для тестов.
export default function FeedbackScreen({ user, onBack, focusId = null, api = defaultApi }) {
  const { online } = useSyncStatus()
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [list, setList] = useState(null)
  const [loadErr, setLoadErr] = useState('')
  // Какие ответы были непрочитаны на момент открытия: метку «новый» держим до
  // ухода с экрана, хотя на сервере она гаснет сразу (ack).
  const [fresh, setFresh] = useState(() => new Set())
  const fileRef = useRef(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function reload({ ack = false } = {}) {
    setLoadErr('')
    try {
      const rows = await api.list(user.id)
      if (!alive.current) return
      setList(rows)
      const unread = rows.filter(hasUnreadReply).map((r) => r.id)
      if (unread.length) {
        setFresh((cur) => new Set([...cur, ...unread]))
        if (ack) api.ack()
      }
    } catch (e) {
      if (!alive.current) return
      setLoadErr(e instanceof FeedbackError ? e.message : 'Не удалось загрузить обращения.')
      setList([])
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (online) reload({ ack: true }); else setList((l) => l ?? []) }, [online, user.id])

  // Превью выбранного скриншота — object URL, освобождаем при смене/уходе.
  useEffect(() => {
    if (!file) { setPreview(null); return undefined }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Пуш привел к конкретному обращению — прокрутить к нему, когда список появился.
  useEffect(() => {
    if (!focusId || !list?.length) return
    document.getElementById(`fb-${focusId}`)?.scrollIntoView?.({ block: 'center' })
  }, [focusId, list])

  const problem = bodyProblem(text)
  const len = text.trim().length

  async function send() {
    if (busy || problem || !online) return
    setBusy(true)
    try {
      const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
      const context = buildContext({
        version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
        userAgent: navigator.userAgent,
        standalone,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        screen: 'profile',
        online: navigator.onLine,
      })
      await api.submit(user.id, { body: text, context, file })
      if (!alive.current) return
      setText('')
      setFile(null)
      showToast({ emoji: '📨', title: 'Отправлено', sub: 'Спасибо! Ответ появится здесь.' })
      reload()
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не отправилось', sub: e instanceof FeedbackError ? e.message : 'Попробуй еще раз.' })
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  function pickFile(e) {
    const f = e.target.files?.[0]
    e.target.value = '' // повторный выбор того же файла тоже срабатывает
    if (f) setFile(f)
  }

  return (
    <div className="screen feedback-screen">
      <div className="admin-head">
        <BackButton onClick={onBack} />
        <h2 className="admin-title">Обратная связь</h2>
      </div>

      <p className="muted fb-intro">
        Нашел ошибку или есть идея? Напиши — сообщение сразу придет разработчику.
        Ответ появится здесь и придет уведомлением.
      </p>

      <section className="admin-add fb-form">
        <label className="field">
          <span className="field-lab">Что случилось?</span>
          <textarea
            className="admin-input fb-text"
            rows={5}
            maxLength={FEEDBACK_MAX + 200}
            placeholder="Например: после сохранения тренировки пропал последний подход"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
        </label>
        <div className={'fb-count' + (len > FEEDBACK_MAX ? ' over' : '')} aria-live="polite">
          {len} / {FEEDBACK_MAX}
        </div>

        {preview ? (
          <div className="fb-shot">
            <img src={preview} alt="Скриншот к обращению" />
            <button type="button" className="btn ghost" onClick={() => setFile(null)} disabled={busy}>
              Убрать скриншот
            </button>
          </div>
        ) : (
          <button type="button" className="btn ghost fb-attach" onClick={() => fileRef.current?.click()} disabled={busy}>
            📎 Приложить скриншот
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickFile} data-testid="fb-file" />

        <p className="admin-hint">
          К сообщению приложим версию приложения и модель телефона — так быстрее разобраться.
        </p>
        {!online && <p className="admin-offline" role="status">Нет связи. Отправить можно будет онлайн.</p>}
        <button className="btn primary" onClick={send} disabled={busy || !!problem || !online}>
          {busy ? 'Отправляю…' : 'Отправить'}
        </button>
      </section>

      <h3 className="sec-title fb-list-title">Мои обращения</h3>
      {loadErr && <p className="admin-offline" role="alert">{loadErr}</p>}
      {list === null && <CardsSkeleton cards={2} />}
      {list?.length === 0 && !loadErr && <p className="muted">Пока пусто.</p>}
      {list?.length > 0 && (
        <ul className="admin-list fb-list">
          {list.map((r) => (
            <li key={r.id} id={`fb-${r.id}`} className={'admin-user fb-item' + (r.id === focusId ? ' focus' : '')}>
              <div className="fb-item-head">
                <span className="admin-ex-meta">{fmtFeedbackDate(r.created_at)}</span>
                <span className={`fb-status s-${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
              </div>
              <p className="fb-body">{r.body}</p>
              {r.has_screenshot && <span className="admin-ex-meta">📎 со скриншотом</span>}
              {r.reply && (
                <div className={'fb-reply' + (fresh.has(r.id) ? ' new' : '')}>
                  <div className="fb-reply-head">
                    <span>Ответ разработчика · {fmtFeedbackDate(r.replied_at)}</span>
                    {fresh.has(r.id) && <span className="act-badge">новый</span>}
                  </div>
                  <p className="fb-body">{r.reply}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
