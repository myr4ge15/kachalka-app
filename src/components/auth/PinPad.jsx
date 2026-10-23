// Ввод PIN на экране входа: четыре точки, «Входим…» или ошибка, цифровая клавиатура
// (вынесено из LoginScreen, аудит 14.10). Презентационный: набранный PIN, проверка и
// автоотправка на 4-й цифре — в экране.
// UI-ревью 23.10: число набранных цифр озвучивается («Введено 2 из 4»), физическая клавиатура (цифры,
// Backspace) тоже вводит — для клавиатуры у iPad и десктопа.
import { useEffect, useRef } from 'react'
import { pluralize } from '../../lib/plural.js'

export default function PinPad({ length, busy, error, onDigit, onBackspace }) {
  const cb = useRef({ onDigit, onBackspace, busy })
  cb.current = { onDigit, onBackspace, busy }
  useEffect(() => {
    const key = (e) => {
      if (cb.current.busy || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return // поле ввода — свое
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); cb.current.onDigit(e.key) }
      else if (e.key === 'Backspace') { e.preventDefault(); cb.current.onBackspace() }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])
  return (
    <>
      <div className="pin-dots" role="img" aria-label={`Введено ${pluralize(length, 'цифра', 'цифры', 'цифр')} из 4`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < length ? 'dot filled' : 'dot'} />
        ))}
      </div>
      {busy ? (
        <div className="login-busy">
          <span className="spinner" aria-hidden="true" />
          <span>Входим…</span>
        </div>
      ) : (
        error && <p className="error" role="alert">{error}</p>
      )}

      <div className={busy ? 'keypad dim' : 'keypad'}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button key={n} className="key" disabled={busy} onClick={() => onDigit(String(n))}>{n}</button>
        ))}
        <span />
        <button className="key" disabled={busy} onClick={() => onDigit('0')}>0</button>
        <button className="key key-del" disabled={busy} onClick={onBackspace} aria-label="Стереть">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" /><path d="M17 9.5l-5 5M12 9.5l5 5" />
          </svg>
        </button>
      </div>
    </>
  )
}
