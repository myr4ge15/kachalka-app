import { useEffect, useState } from 'react'
import { getMyLogin, setMyLogin, LoginError } from '../../lib/auth.js'
import { normalizeLogin } from '../../lib/login.js'
import LoginField from '../LoginField.jsx'
import { showToast } from '../Toast.jsx'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import { useAliveRef } from '../../hooks/useAliveRef.js'

// Логин для входа в Настройках (П4 «Мой круг», 07.10.2026; решение владельца — виден
// и меняется здесь). Логин знает только сам человек: сервер отдает его лишь владельцу
// (my_login), поэтому показываем онлайн; офлайн — «виден онлайн».
// Свернуто — пункт «🔤 Логин для входа · sega», раскрыто — форма как у смены PIN.
export default function LoginChangeForm({ userId }) {
  const aliveRef = useAliveRef()
  const [current, setCurrent] = useState(undefined) // undefined — еще не знаем, null — нет
  const [open, setOpen] = useState(false)
  const formRef = useRevealFocus(open)
  const [value, setValue] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    if (!navigator.onLine) return undefined
    getMyLogin(userId).then((l) => { if (alive) setCurrent(l) }, () => {})
    return () => { alive = false }
  }, [userId])

  function openForm() { setValue(current ?? ''); setErr(''); setOpen(true) }
  function close() { setOpen(false); setErr(''); setBusy(false) }

  async function submit() {
    if (normalizeLogin(value) === current) { close(); return }
    setBusy(true)
    setErr('')
    try {
      const saved = await setMyLogin(userId, value)
      if (!aliveRef.current) return
      setCurrent(saved)
      close()
      showToast({ emoji: '🔤', title: 'Логин сохранен', sub: `Вход — по «${saved}».` })
    } catch (e) {
      if (!aliveRef.current) return
      setBusy(false)
      setErr(e instanceof LoginError ? e.message : 'Не удалось сохранить логин.')
    }
  }

  if (!open) {
    const sub = current === undefined ? 'виден онлайн' : current === null ? 'еще не задан' : current
    return (
      <button className="act" onClick={openForm}>
        <span className="act-txt">
          🔤 Сменить логин для входа
          <span className="act-sub">Текущий логин: {sub}</span>
        </span>
      </button>
    )
  }
  return (
    <div className="pin-form" ref={formRef}>
      <p className="pin-form-title">Сменить логин для входа</p>
      {current && <p className="muted">Текущий логин: {current}</p>}
      <LoginField value={value} disabled={busy} label="Новый логин" onChange={(v) => { setValue(v); setErr('') }} />
      {err && <p className="pin-err" role="alert">{err}</p>}
      <div className="pin-form-actions">
        <button className="btn ghost" onClick={close} disabled={busy}>Отмена</button>
        <button className="btn primary" onClick={submit} disabled={busy}>
          {busy ? 'Сохраняю…' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}
