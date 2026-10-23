import { useEffect, useState } from 'react'
import { getMyLogin, setMyLogin, LoginError } from '../../lib/auth.js'
import { loginProblem, normalizeLogin } from '../../lib/login.js'
import LoginField from '../auth/LoginField.jsx'
import { showToast } from '../ui/Toast.jsx'
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

  // Вошли офлайн — логин дочитываем, когда сеть вернется (UI-ревью 23.10: «виден онлайн» висел до
  // переоткрытия экрана); раскрытие формы тоже переспрашивает, если логин еще не знаем.
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let alive = true
    const load = () => {
      if (!navigator.onLine) return
      getMyLogin(userId).then((l) => { if (alive) setCurrent(l) }, () => {})
    }
    load()
    window.addEventListener('online', load)
    return () => { alive = false; window.removeEventListener('online', load) }
  }, [userId, retry])

  function openForm() {
    setValue(current ?? ''); setErr(''); setOpen(true)
    if (current === undefined) setRetry((n) => n + 1)
  }
  function close() { setOpen(false); setErr(''); setBusy(false) }

  async function submit() {
    if (normalizeLogin(value) === current) { close(); return }
    // Формат — до сервера, тем же правилом, что подсказка под полем (UI-ревью 23.10).
    const problem = loginProblem(value)
    if (problem) { setErr(problem); return }
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
