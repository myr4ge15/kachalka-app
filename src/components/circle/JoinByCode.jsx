import { useEffect, useRef, useState } from 'react'
import { fmtCode, joinStatusText, normCode } from '../../lib/friendCircles.js'

// «Вступить по коду» (уже с учеткой): код → превью «Сега зовет в «Зал»» → вступить.
// initialCode — из ссылки #join=… (сразу показываем превью).
export default function JoinByCode({ api, initialCode = '', onJoined, compact = false }) {
  const [code, setCode] = useState(initialCode ? fmtCode(initialCode) : '')
  const [preview, setPreview] = useState(null) // { status, circle_name, inviter_name }
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function check(value = code) {
    if (!normCode(value)) { setMsg(joinStatusText('invalid')); return }
    setBusy(true); setMsg(''); setPreview(null)
    try {
      const p = await api.preview(value)
      if (!alive.current) return
      if (p?.status === 'ok') setPreview(p)
      else setMsg(joinStatusText(p?.status))
    } catch (e) {
      if (alive.current) setMsg(e.message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialCode) check(initialCode) }, [initialCode])

  async function join() {
    setBusy(true); setMsg('')
    try {
      const r = await api.join(code)
      if (!alive.current) return
      setPreview(null)
      setMsg(joinStatusText(r?.status))
      if (r?.status === 'active' || r?.status === 'pending') { setCode(''); onJoined?.(r) }
    } catch (e) {
      if (alive.current) setMsg(e.message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <div className={compact ? 'fc-join' : 'card fc-join'}>
      {!compact && <h3 className="fc-h">Вступить по коду</h3>}
      <div className="field">
        <label className="field-lab" htmlFor="fc-join-code">Код от друга</label>
        <div className="fc-join-row">
          <input id="fc-join-code" className="admin-input fc-code-input" type="text" maxLength={12}
            autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="XXXX-XXXX"
            value={code} disabled={busy}
            onChange={(e) => { setCode(e.target.value); setPreview(null); setMsg('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') check() }} />
          <button type="button" className="btn ghost" disabled={busy || !code.trim()} onClick={() => check()}>
            {busy && !preview ? '…' : 'Проверить'}
          </button>
        </div>
      </div>
      {preview && (
        <div className="fc-preview" role="status">
          <p><b>{preview.inviter_name}</b> зовет в круг <b>«{preview.circle_name}»</b></p>
          <button type="button" className="btn primary" disabled={busy} onClick={join}>
            {busy ? 'Вступаю…' : 'Вступить'}
          </button>
        </div>
      )}
      {msg && <p className="muted fc-msg" role="status">{msg}</p>}
    </div>
  )
}
