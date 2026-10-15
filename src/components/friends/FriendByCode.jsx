import { useEffect, useRef, useState } from 'react'
import { codeStatusText, fmtCode, normCode } from '../../lib/friends.js'

// «Ввести код» друга: код → превью «Сега зовет в друзья» → «Принять».
// initialCode — из ссылки #friend=… (сразу показываем превью).
export default function FriendByCode({ api, initialCode = '', onAdded }) {
  const [code, setCode] = useState(initialCode ? fmtCode(initialCode) : '')
  const [preview, setPreview] = useState(null) // { status, inviter_name }
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function check(value = code) {
    if (!normCode(value)) { setMsg(codeStatusText('invalid')); return }
    setBusy(true); setMsg(''); setPreview(null)
    try {
      const p = await api.preview(value)
      if (!alive.current) return
      if (p?.status === 'ok') setPreview(p)
      else setMsg(codeStatusText(p?.status))
    } catch (e) {
      if (alive.current) setMsg(e.message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialCode) check(initialCode) }, [initialCode])

  async function accept() {
    setBusy(true); setMsg('')
    try {
      const r = await api.acceptCode(code)
      if (!alive.current) return
      setPreview(null)
      setMsg(codeStatusText(r?.status))
      if (r?.status === 'ok' || r?.status === 'already') { setCode(''); onAdded?.(r) }
    } catch (e) {
      if (alive.current) setMsg(e.message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <div className="card fc-join">
      <h3 className="fc-h">Ввести код друга</h3>
      <div className="field">
        <label className="field-lab" htmlFor="fr-code-input">Код от друга</label>
        <div className="fc-join-row">
          <input id="fr-code-input" className="admin-input fc-code-input" type="text" maxLength={12}
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
          <p><b>{preview.inviter_name}</b> зовет тебя в друзья</p>
          <button type="button" className="btn primary" disabled={busy} onClick={accept}>
            {busy ? 'Добавляю…' : 'Принять'}
          </button>
        </div>
      )}
      {msg && <p className="muted fc-msg" role="status">{msg}</p>}
    </div>
  )
}
