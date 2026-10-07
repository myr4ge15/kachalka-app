import { useEffect, useId, useRef, useState } from 'react'
import { loginProblem, loginStatusText, normalizeLogin } from '../lib/login.js'

// Поле «Логин (для входа)» (П4 «Мой круг», 07.10.2026). Одна разметка для регистрации,
// шага «Придумай логин», Настроек и Админки.
//
// Пропсы:
//   value, onChange(v)  — значение (как набрано; нормализует сервер и lib/login.js);
//   check(login)        — необязательная проверка занятости → статус сервера
//                         ('ok' | 'taken' | 'reserved' | 'bad' | 'limited'); зовется
//                         через 600 мс после последнего ввода и только для логина,
//                         который прошел проверку формата;
//   disabled, autoFocus.
// Подсказка под полем: формат → «проверяю…» → «свободен ✓» / причина отказа.
const DEBOUNCE_MS = 600
const NOTE = 'Латиница, цифры, точка и _. Нужен только для входа — друзья его не видят.'

export default function LoginField({ value, onChange, check, disabled = false, autoFocus = false, label = 'Логин (для входа)' }) {
  const id = useId()
  const [state, setState] = useState({ kind: 'note' }) // note | checking | ok | bad
  const seq = useRef(0)

  useEffect(() => {
    const v = normalizeLogin(value)
    const my = ++seq.current
    if (!v) { setState({ kind: 'note' }); return undefined }
    const problem = loginProblem(v)
    if (problem) { setState({ kind: 'bad', text: problem }); return undefined }
    if (!check) { setState({ kind: 'note' }); return undefined }
    setState({ kind: 'checking' })
    const t = setTimeout(async () => {
      let status
      try { status = await check(v) } catch { status = null }
      if (my !== seq.current) return // уже набрали другое
      if (status === 'ok') setState({ kind: 'ok' })
      else if (status === null || status === 'invalid') setState({ kind: 'note' }) // нет сети — решит сервер при отправке
      else setState({ kind: 'bad', text: loginStatusText(status) })
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [value, check])

  const hint = state.kind === 'checking' ? 'Проверяю…'
    : state.kind === 'ok' ? 'Свободен ✓'
      : state.kind === 'bad' ? state.text
        : NOTE
  // Подсказка — ВНЕ <label>: иначе ее текст входит в доступное имя поля.
  return (
    <div className="field">
      <label className="field-lab" htmlFor={id + 'in'}>{label}</label>
      <input id={id + 'in'} className="admin-input" type="text" maxLength={20} autoComplete="username"
        autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus={autoFocus}
        aria-describedby={id} aria-invalid={state.kind === 'bad' ? true : undefined}
        value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      <span id={id} className={'field-hint' + (state.kind === 'ok' ? ' ok' : state.kind === 'bad' ? ' bad' : '')}
        aria-live="polite">{hint}</span>
    </div>
  )
}
