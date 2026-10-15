import { useEffect, useRef, useState } from 'react'
import { fmtCode, friendMessage, friendUrl } from '../../lib/friends.js'
import { showToast } from '../ui/Toast.jsx'

// Мой код дружбы: крупно; «Поделиться», «Скопировать», «Новый код» (старый сразу гаснет).
// Код многоразовый и бессрочный: открыл ссылку — и вы друзья, без подтверждения.
export default function FriendCode({ api, myName }) {
  const [code, setCode] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmNew, setConfirmNew] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function load(rotate = false) {
    setBusy(true); setErr('')
    try {
      const c = await api.myCode(rotate)
      if (alive.current) { setCode(c); setConfirmNew(false) }
    } catch (e) {
      if (alive.current) setErr(e.message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const url = code ? friendUrl(code.code, window.location.origin, import.meta.env.BASE_URL ?? '/') : ''
  const text = code ? friendMessage({ name: myName, code: fmtCode(code.code), url }) : ''
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      showToast({ emoji: '📋', title: 'Скопировано', sub: 'Отправь другу — код и ссылка внутри.' })
    } catch {
      setErr('Не удалось скопировать — перепиши код вручную.')
    }
  }
  async function share() {
    try { await navigator.share({ title: 'Журнал тренировок', text }) } catch { /* отменил */ }
  }

  return (
    <div className="card fc-code-card">
      <h3 className="fc-h">Мой код</h3>
      {code ? (
        <>
          <p className="fc-code" data-testid="fr-code">{fmtCode(code.code)}</p>
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
          {confirmNew && <p className="muted fc-msg">Старый код сразу перестанет работать. Друзья останутся друзьями.</p>}
          <p className="muted fc-msg">Кто откроет ссылку или введет код, сразу станет твоим другом: вы будете видеть тренировки друг друга. Отправляй тем, кого знаешь.</p>
        </>
      ) : (
        !err && <p className="muted" role="status">{busy ? 'Загружаю код…' : ''}</p>
      )}
      {err && <p className="pin-err" role="alert">{err}</p>}
    </div>
  )
}
