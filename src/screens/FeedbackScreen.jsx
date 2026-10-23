import FeedbackScreenshotPicker from '../components/social/FeedbackScreenshotPicker.jsx'
import MyFeedbackItem from '../components/social/MyFeedbackItem.jsx'
import { useEffect, useRef, useState } from 'react'
import BackButton from '../components/ui/BackButton.jsx'
import BusyText from '../components/ui/BusyText.jsx'
import UploadProgress from '../components/social/UploadProgress.jsx'
import CardsSkeleton from '../components/ui/CardsSkeleton.jsx'
import ScrollTopButton from '../components/ui/ScrollTopButton.jsx'
import { showToast } from '../components/ui/Toast.jsx'
import { useSyncStatus } from '../db/sync.js'
import { onResume } from '../lib/appEvents.js'
import {
  bodyProblem, buildContext, hasUnreadReply, isOpenStatus, isWebKit26Plus, myFeedbackTab, FEEDBACK_MAX,
} from '../lib/feedback.js'
import {
  ackMyFeedback, appendFeedback, feedbackMedia, listMyFeedback, reopenFeedback, submitFeedback as defaultSubmit,
  FeedbackError, attachUploadedScreenshots, discardAttachments, uploadAttachment,
} from '../lib/feedbackApi.js'
import { useAttachments, NOT_READY } from '../hooks/useAttachments.js'
import { withDeviceLogs } from '../lib/deviceLogs.js'
import { readPushLog } from '../lib/pushIntent.js'
import { readSwipeLog } from '../lib/swipeLog.js'

// Вложения грузятся сразу после выбора (upload/discard, 20.10.2026); submit и attach получают пути.
const defaultApi = {
  submit: defaultSubmit, list: listMyFeedback, ack: ackMyFeedback, reopen: reopenFeedback, media: feedbackMedia,
  append: appendFeedback, attach: attachUploadedScreenshots, upload: uploadAttachment, discard: discardAttachments,
  readLogs: async () => ({ swipes: readSwipeLog(), pushes: await readPushLog() }),
}

// «Написать разработчику» (v6.11.0, Профиль → Настройки). Обращение уходит
// разработчику в Telegram; ответ и статус видны здесь и приходят пушем
// (tag feedback-<id> открывает этот экран и подсвечивает обращение).
// Пропсы: user, onBack(), [focusId] — id из пуша, [fromScreen] — вкладка, с которой
// пришли в Настройки (в контекст обращения), [api] — для тестов.
export default function FeedbackScreen({ user, onBack, focusId = null, fromScreen = null, viaScreen = null, api = defaultApi }) {
  const { online } = useSyncStatus()
  const [text, setText] = useState('')
  // Приложить журналы свайпов и пушей этого телефона (23.10.2026, lib/deviceLogs.js).
  const [withLogs, setWithLogs] = useState(false)
  const att = useAttachments(user.id, api)
  const [busy, setBusy] = useState(false)
  const [list, setList] = useState(null)
  const [loadErr, setLoadErr] = useState('')
  // Какие ответы были непрочитаны на момент открытия: метку «новый» держим до
  // ухода с экрана, хотя на сервере она гаснет сразу (ack).
  const [fresh, setFresh] = useState(() => new Set())
  // Вкладка «Открытые / Закрытые» (16.10): null — еще не выбрана, берем по списку (myFeedbackTab).
  const [tab, setTab] = useState(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const [loading, setLoading] = useState(false)

  async function reload({ ack = false } = {}) {
    setLoadErr('')
    setLoading(true)
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
    } finally {
      if (alive.current) setLoading(false)
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (online) reload({ ack: true }); else setList((l) => l ?? []) }, [online, user.id])
  // Обновить список (fb_6e2e0d6c): кнопкой у заголовка и сам при возврате в приложение —
  // ответ мог прийти, пока экран висел открытым в фоне.
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  useEffect(() => onResume(() => { if (navigator.onLine) reloadRef.current({ ack: true }) }), [])

  // Новое обращение в фокусе на уже открытом экране (16.10, fb_bb404b7e: экран оставался на
  // прежнем) — вкладку снова выбирает список (myFeedbackTab по focusId).
  const [focusSeen, setFocusSeen] = useState(focusId)
  if (focusId !== focusSeen) {
    setFocusSeen(focusId)
    if (focusId) setTab(null)
  }

  // Пуш привел к конкретному обращению — прокрутить к нему, когда список появился.
  useEffect(() => {
    if (!focusId || !list?.length) return
    document.getElementById(`fb-${focusId}`)?.scrollIntoView?.({ block: 'center' })
  }, [focusId, list])

  const cur = tab ?? myFeedbackTab(list, focusId)
  const openRows = (list ?? []).filter((r) => isOpenStatus(r.status))
  const closedRows = (list ?? []).filter((r) => !isOpenStatus(r.status))
  const shown = cur === 'open' ? openRows : closedRows
  // Раскрытое с новым ответом — уже прочитано: метка и точка вкладки гаснут (9.3.3).
  const [seenFresh, setSeenFresh] = useState(() => new Set())
  const freshIn = (rows) => rows.some((r) => fresh.has(r.id) && !seenFresh.has(r.id))

  const problem = bodyProblem(text)
  const len = text.trim().length

  // Пока вложения догружаются перед отправкой, отправку можно отменить и лишний файл убрать (23.10, баг
  // владельца: отмены не было вовсе — оставалось ждать или уходить с экрана). Текст и файлы остаются в форме.
  const [waiting, setWaiting] = useState(false)
  // Номер попытки: отмена или новая отправка делают прежнюю «устаревшей» — она не уйдет, когда догрузится.
  const attempt = useRef(0)
  async function send() {
    if (busy || problem || !online) return
    setBusy(true)
    const my = ++attempt.current
    try {
      const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
      const base = buildContext({
        version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
        userAgent: navigator.userAgent,
        modernWebKit: isWebKit26Plus(),
        standalone,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        screen: fromScreen ?? 'profile',
        via: viaScreen,
        online: navigator.onLine,
      })
      const context = withLogs ? withDeviceLogs(base, await api.readLogs().catch(() => ({}))) : base
      setWaiting(true)
      const paths = await att.readyPaths() // ждем догрузки выбранного (кольца на миниатюрах)
      if (alive.current) setWaiting(false)
      if (my !== attempt.current) return // «Отменить отправку», пока догружалось
      await api.submit(user.id, { body: text, context, paths })
      if (!alive.current) return
      setText('')
      setWithLogs(false)
      att.commit()
      // Обращение уже в базе — его видят Админка и desk; задержка Telegram (а на бете Telegram нет вовсе) участника
      // не касается, поэтому «доставка задержалась» не пишем (fb_e87fb37b).
      showToast({ emoji: '📨', title: 'Отправлено', sub: 'Спасибо! Ответ появится здесь.' })
      reload()
    } catch (e) {
      if (alive.current) setWaiting(false)
      if (my !== attempt.current) return
      showToast({ emoji: '⚠️', title: 'Не отправилось', sub: e instanceof FeedbackError || e?.message === NOT_READY ? e.message : 'Попробуй еще раз.' })
    } finally {
      if (alive.current && my === attempt.current) setBusy(false) // устаревшая попытка не снимает «занято» с новой
    }
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
        <div className={'fb-count' + (len > FEEDBACK_MAX ? ' over' : '')}>
          {len} / {FEEDBACK_MAX}
        </div>

        <FeedbackScreenshotPicker items={att.items} onAdd={att.add} onRemove={att.remove} onRetry={att.retry}
          disabled={(busy && !waiting) || !online} />

        <label className="fb-logs">
          <input type="checkbox" checked={withLogs} disabled={busy} onChange={(e) => setWithLogs(e.target.checked)} />
          <span>Приложить журналы свайпов и уведомлений</span>
        </label>
        <p className="admin-hint">
          К сообщению приложим версию приложения и модель телефона — так быстрее разобраться.
          {withLogs && ' Журналы — последние свайпы «назад» и шаги уведомлений на этом телефоне, без данных тренировок.'}
        </p>
        {!online && <p className="admin-offline" role="status">Нет связи. Отправить можно будет онлайн.</p>}
        {busy && att.progress && <UploadProgress progress={att.progress} />}
        <button className="btn primary" onClick={send} disabled={busy || !!problem || !online}>
          {busy ? <BusyText>{att.uploading ? 'Догружаю' : 'Отправляю'}</BusyText> : 'Отправить'}
        </button>
        {busy && waiting && (
          <button type="button" className="btn ghost" onClick={() => { attempt.current += 1; setWaiting(false); setBusy(false) }}>
            Отменить отправку
          </button>
        )}
      </section>

      <div className="fb-list-head">
        <h3 className="sec-title fb-list-title">Мои обращения</h3>
        <button type="button" className="fb-refresh" onClick={() => reload({ ack: true })}
          disabled={!online || loading} aria-label={loading ? 'Обновляется' : 'Обновить список'} title="Обновить список">
          <svg className={loading ? 'fb-refresh-ico spin' : 'fb-refresh-ico'} viewBox="0 0 24 24" width="20" height="20"
            fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" />
          </svg>
        </button>
      </div>
      {loadErr && <p className="admin-offline" role="alert">{loadErr}</p>}
      {list === null && <CardsSkeleton cards={2} />}
      {list?.length === 0 && !loadErr && <p className="muted">Пока пусто.</p>}
      {list?.length > 0 && (
        <>
          <div className="seg fb-filter" role="tablist" aria-label="Какие обращения показать">
            <button role="tab" aria-selected={cur === 'open'} className={'seg-item' + (cur === 'open' ? ' on' : '')}
              onClick={() => setTab('open')}>
              Открытые · {openRows.length}{cur !== 'open' && freshIn(openRows) && <span className="fb-tab-dot" aria-label="есть новый ответ" />}
            </button>
            <button role="tab" aria-selected={cur === 'closed'} className={'seg-item' + (cur === 'closed' ? ' on' : '')}
              onClick={() => setTab('closed')}>
              Закрытые · {closedRows.length}{cur !== 'closed' && freshIn(closedRows) && <span className="fb-tab-dot" aria-label="есть новый ответ" />}
            </button>
          </div>
          {shown.length === 0 && <p className="muted fb-empty">{cur === 'open' ? 'Открытых нет — все разобрано.' : 'Закрытых пока нет.'}</p>}
          <ul className="admin-list fb-list">
            {shown.map((r) => (
              <MyFeedbackItem key={r.id} row={r} userId={user.id} api={api} online={online}
                fresh={fresh.has(r.id)} focus={r.id === focusId} onReload={() => reload()}
                onSeen={(id) => setSeenFresh((cur) => new Set(cur).add(id))} />
            ))}
          </ul>
        </>
      )}
      {/* «Наверх» (v8.8.0, как в профиле участника): список обращений длинный, форма — в самом верху. */}
      <ScrollTopButton />
    </div>
  )
}
