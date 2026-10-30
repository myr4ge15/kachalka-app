import { useEffect, useRef, useState } from 'react'
import { codeMeta, fmtCode, joinMessage, joinUrl } from '../../lib/friendCircles.js'
import { showToast } from '../ui/Toast.jsx'
import MenuRow from '../ui/MenuRow.jsx'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'

// Мой личный код в круг: крупно, срок и сколько вступили; «Поделиться», «Скопировать»,
// «Новый код» (старый сразу перестает работать). Код многоразовый: 7 дней или 10 человек.
// Аккордеон: пока в круге никого, кроме тебя, позвать друга — главное на экране, код открыт сразу.
// Состав считаем от свежего circle, а не один раз: экран сперва рисует снимок, он может быть старым.
// Панель смонтирована и свернутой: код уже загружен, и раскрытие не дергает экран через «Загружаю код…».
export default function CircleCode({ api, circle }) {
  const [manual, setManual] = useState(null) // выбор человека сильнее правила
  const open = manual ?? !(circle.members > 1)
  const revealRef = useRevealFocus(open)
  return (
    <div className="fc-fold" ref={revealRef}>
      <MenuRow kind="expand" icon="invite" title="Мой код в круг" open={open} onClick={() => setManual(!open)} />
      <div hidden={!open}><CodePanel api={api} circle={circle} /></div>
    </div>
  )
}

function CodePanel({ api, circle }) {
  const [code, setCode] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmNew, setConfirmNew] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function load(rotate = false) {
    setBusy(true); setErr('')
    try {
      const c = await api.myCode(circle.circle_id, rotate)
      if (alive.current) { setCode(c); setConfirmNew(false) }
    } catch (e) {
      if (alive.current) setErr(e.message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [circle.circle_id])

  const url = code ? joinUrl(code.code, window.location.origin, import.meta.env.BASE_URL ?? '/') : ''
  const text = code ? joinMessage({ circle: circle.name, code: code.code, url }) : ''
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      showToast({ icon: 'copy', title: 'Скопировано', sub: 'Отправь другу — код и ссылка внутри.' })
    } catch {
      setErr('Не удалось скопировать — перепиши код вручную.')
    }
  }
  // Тап по коду — скопировать только код (v8.9.9: на iPhone выделение рвалось на дефисе).
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(fmtCode(code.code))
      showToast({ icon: 'copy', title: 'Код скопирован' })
    } catch { /* выделение все равно работает */ }
  }
  async function share() {
    try { await navigator.share({ title: 'Журнал тренировок', text }) } catch { /* отменил */ }
  }

  return (
    <div className="card fc-code-card">
      {code ? (
        <>
          <p className="fc-code" data-testid="fc-code" role="button" tabIndex={0} aria-label={`Код ${fmtCode(code.code)} — нажми, чтобы скопировать`}
            onClick={copyCode} onKeyDown={(e) => { if (e.key === 'Enter') copyCode() }}>{fmtCode(code.code)}</p>
          <p className="muted fc-code-meta">{codeMeta(code)}</p>
          <div className="fc-actions">
            {canShare && <button type="button" className="btn primary" onClick={share}>Поделиться</button>}
            <button type="button" className={canShare ? 'btn ghost' : 'btn primary'} onClick={copy}>Скопировать</button>
          </div>
          {confirmNew ? (
            <div className="fc-actions">
              <button type="button" className="btn ghost" onClick={() => setConfirmNew(false)} disabled={busy}>Отмена</button>
              <button type="button" className="btn ghost" onClick={() => load(true)} disabled={busy}>Да, новый код</button>
            </div>
          ) : (
            <button type="button" className="link-btn fc-new-code" onClick={() => setConfirmNew(true)} disabled={busy}>Новый код</button>
          )}
          {confirmNew && <p className="muted fc-msg">Старый код сразу перестанет работать.</p>}
          <p className="muted fc-msg">Код многоразовый: по нему можно позвать до 10 человек за 7 дней. Кто пришел по твоему коду — видно в списке участников.</p>
        </>
      ) : (
        !err && <p className="muted" role="status">{busy ? 'Загружаю код…' : ''}</p>
      )}
      {err && <p className="pin-err" role="alert">{err}</p>}
    </div>
  )
}
