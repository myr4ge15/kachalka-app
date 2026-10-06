import { useState, useEffect, useRef } from 'react'
import { getUsers } from '../db/repo.js'
import { migrateLoginZone } from '../db/local.js'
import {
  login as authLogin, loginByName, verifyPinOffline, dropForeignSession, noteLoginFailure,
  knownAccounts, forgetAccount, LoginError,
} from '../lib/auth.js'
import { loadPending, savePending, clearPending, pollJoin, joinPollDelay } from '../lib/joinRequest.js'
import { onlyDigits } from '../lib/text.js'
import AppMark from '../components/AppMark.jsx'
import BackButton from '../components/BackButton.jsx'
import JoinRequestForm from '../components/JoinRequestForm.jsx'

// Экран входа (v6.12.0).
//   • Пикер показывает ТОЛЬКО учетки, уже входившие на этом устройстве (есть
//     офлайн-кэш PIN). Список всех участников экран больше не запрашивает: кто
//     случайно открыл ссылку на приложение, круг не видит.
//   • Новое устройство (или другой человек) — «Войти по имени»: имя + PIN, онлайн.
//     Сервер прощает регистр, пробелы и знаки и узнает однозначное начало имени.
//   • «Забыть на этом устройстве» — убрать учетку из пикера (на экране PIN).
//   • «Запросить доступ» (до 6.16.0 — «Запросить приглашение», до 6.14.1 — «Попросить приглашение», до 6.13.3 — «Хочу в круг») — заявка владельцу; одобрено → регистрация по приглашению
//     (onInvite(token) → InviteScreen).
// Сколько ждать сервер при входе с пикера, прежде чем открыть приложение по кэшу.
const LOGIN_ONLINE_TIMEOUT_MS = 8000
// Коды LoginError, при которых сервер «не ответил» (а не «отказал»).
const SERVER_DOWN = new Set(['network', 'server'])

export default function LoginScreen({ onLogin, onInvite }) {
  const [known, setKnown] = useState([])
  const [mode, setMode] = useState('loading') // 'loading' | 'pick' | 'pin' | 'name' | 'join'
  const [selected, setSelected] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmForget, setConfirmForget] = useState(false)
  const [pending, setPending] = useState(() => loadPending())
  const [joinNote, setJoinNote] = useState(null) // 'declined' | null
  // Синхронный замок «попытка в полете»: setBusy(true) применяется асинхронно,
  // поэтому гонка backspace+перенабор до 4 цифр могла вызвать submit() дважды до
  // ре-рендера (лишняя попытка → инфляция серверного счетчика блокировки).
  const inFlight = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function reloadKnown() {
    const list = await knownAccounts(await getUsers())
    if (alive.current) setKnown(list)
    return list
  }

  useEffect(() => {
    async function load() {
      // Перенос «загрузочной зоны» со старой общей базы (ростер + офлайн-кэш PIN).
      await migrateLoginZone()
      const list = await reloadKnown().catch(() => [])
      if (alive.current) setMode(list.length ? 'pick' : 'name')
    }
    load()
  }, [])

  // Ожидающая заявка «Запросить доступ»: при открытии экрана спрашиваем статус.
  // Один запрос за раз: таймер, возврат во вкладку и «Проверить» могут совпасть.
  const joinPolling = useRef(false)
  async function checkJoin(p = pending) {
    if (!p || p.token || !navigator.onLine || joinPolling.current) return
    joinPolling.current = true
    try {
      const res = await pollJoin(p)
      if (!alive.current) return
      if (res.token) {
        const next = { ...p, token: res.token }
        savePending(next)
        setPending(next)
        onInvite?.(res.token)
      } else if (res.status === 'declined') {
        clearPending(); setPending(null); setJoinNote('declined')
      } else if (res.status !== 'new' && res.status !== 'approved') {
        clearPending(); setPending(null) // claimed без токена / invalid — забыть молча
      }
    } catch { /* нет сети — проверим в следующий раз */ } finally {
      joinPolling.current = false
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { checkJoin() }, [])

  // Пока заявка ждет ответа, экран переспрашивает сам (v6.14.3): владелец нажал
  // «Пригласить» — регистрация открывается без кнопки «Проверить». Часто первые
  // минуты, потом реже (joinPollDelay); при возврате во вкладку, фокусе и появлении
  // сети — сразу. Скрытую вкладку не дергаем.
  const waitingJoinId = pending && !pending.token ? pending.id : null
  useEffect(() => {
    if (!waitingJoinId) return
    const started = Date.now()
    let timer = null
    let stopped = false
    const schedule = () => {
      timer = setTimeout(async () => {
        if (!document.hidden) await checkJoin()
        if (!stopped) schedule()
      }, joinPollDelay(Date.now() - started))
    }
    const checkNow = () => { if (!document.hidden) checkJoin() }
    schedule()
    document.addEventListener('visibilitychange', checkNow)
    window.addEventListener('focus', checkNow)
    window.addEventListener('online', checkNow)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', checkNow)
      window.removeEventListener('focus', checkNow)
      window.removeEventListener('online', checkNow)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingJoinId])

  function goPick() {
    setSelected(null); setPin(''); setError(''); setConfirmForget(false)
    setMode(known.length ? 'pick' : 'name')
  }

  function pickUser(u) {
    setSelected(u); setPin(''); setError(''); setConfirmForget(false); setMode('pin')
  }

  function pressDigit(d) {
    if (busy || pin.length >= 4) return
    setError('')
    setPin(pin + d)
  }

  function backspace() {
    if (busy) return
    setPin(pin.slice(0, -1))
  }

  function showError(e) {
    if (e instanceof LoginError && e.code === 'locked') {
      const mins = e.retryAfter ? Math.ceil(e.retryAfter / 60) : null
      setError(mins ? `Слишком много попыток. Попробуй через ${mins} мин.` : 'Слишком много попыток. Подожди немного.')
    } else if (e instanceof LoginError) {
      setError(e.message)
    } else {
      setError('Ошибка входа: ' + (e?.message ?? e))
    }
  }

  async function submitPin() {
    if (pin.length !== 4 || !selected || busy || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      // Онлайн — СНАЧАЛА сервер (ревью 06.10.2026, п. 6). Раньше кэш хэша открывал
      // приложение мгновенно, а сервер проверял уже в фоне: после сброса PIN админом
      // или смены PIN на другом телефоне старый PIN продолжал пускать на этом.
      // Теперь кэш — только запасной путь, когда сервер недоступен (сеть, таймаут,
      // 5xx). «Неверный PIN» и «слишком много попыток» от сервера кэшем не обойти.
      if (navigator.onLine) {
        try {
          const user = await authLogin(selected.id, pin, { timeoutMs: LOGIN_ONLINE_TIMEOUT_MS })
          onLogin(user)
          return
        } catch (e) {
          if (!(e instanceof LoginError) || !SERVER_DOWN.has(e.code)) {
            noteLoginFailure(e) // неверный PIN — стереть устаревший кэш хэша
            throw e
          }
          // сервер недоступен — ниже вход по кэшу, как офлайн
        }
      }
      // Офлайн (или сервер не ответил) — по локальному кэшу своего хэша.
      //    {id,name,role} — PIN совпал; false — не совпал; null — кэша нет.
      const offline = await verifyPinOffline(selected.id, pin)
      if (offline) {
        // Чужую сессию снимаем ДО входа (ее SIGNED_OUT должен отработать здесь).
        await dropForeignSession(selected.id)
        // Сессию синк поднимет сам, когда сервер ответит (refreshSessionSilently).
        onLogin(offline)
        return
      }
      setError(offline === false
        ? 'Неверный PIN'
        : 'Нет связи с сервером. Подключись к интернету, чтобы войти.')
      setPin('')
    } catch (e) {
      showError(e)
      setPin('')
    } finally {
      if (alive.current) setBusy(false)
      inFlight.current = false
    }
  }

  // Автопроверка при вводе 4-й цифры
  useEffect(() => {
    if (mode === 'pin' && pin.length === 4) submitPin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  async function forget() {
    if (!confirmForget) { setConfirmForget(true); return }
    await forgetAccount(selected.id)
    const list = await reloadKnown()
    setSelected(null); setPin(''); setError(''); setConfirmForget(false)
    setMode(list.length ? 'pick' : 'name')
  }

  const mark = <AppMark />

  // Статус заявки «Запросить доступ» (над формами входа).
  let joinCard = null
  if (pending?.token) {
    joinCard = (
      <div className="join-status" role="status">
        <p><b>Тебя приняли в круг 🎉</b></p>
        <p className="muted">Осталось придумать PIN и войти.</p>
        <button className="btn primary" onClick={() => onInvite?.(pending.token)}>Зарегистрироваться</button>
        <button className="link-btn" onClick={() => { clearPending(); setPending(null) }}>Убрать</button>
      </div>
    )
  } else if (pending) {
    joinCard = (
      <div className="join-status" role="status">
        <p><b>Заявка отправлена</b>{pending.name ? ` — ${pending.name}` : ''}</p>
        <p className="muted">Как только владелец ответит, приглашение откроется здесь.</p>
        <button className="btn ghost" onClick={() => checkJoin()}>Проверить</button>
        <button className="link-btn" onClick={() => { clearPending(); setPending(null) }}>Отменить заявку</button>
      </div>
    )
  } else if (joinNote === 'declined') {
    joinCard = (
      <div className="join-status" role="status">
        <p>Владелец пока не принял заявку.</p>
        <button className="link-btn" onClick={() => setJoinNote(null)}>Понятно</button>
      </div>
    )
  }

  if (mode === 'loading') {
    return <div className="screen center"><p className="muted">Загрузка…</p></div>
  }

  if (mode === 'join') {
    return (
      <div className="screen center">
        <div className="card login-card invite-card">
          {mark}
          <h1 className="title">Запросить доступ</h1>
          <JoinRequestForm
            onBack={goPick}
            onSubmitted={(p) => { setPending(p); setJoinNote(null); goPick() }}
          />
        </div>
      </div>
    )
  }

  if (mode === 'name') {
    return (
      <div className="screen center">
        <div className="card login-card invite-card">
          {known.length > 0 && (
            <div className="login-pin-head"><BackButton onClick={goPick} label="К списку" /></div>
          )}
          {mark}
          <h1 className="title">Журнал тренировок</h1>
          <p className="muted login-sub">Введи свое имя и PIN</p>
          {joinCard}
          <NameLoginForm onLogin={onLogin} showError={showError} error={error} setError={setError} />
          {!pending && (
            <div className="login-alt">
              <button className="link-btn" onClick={() => { setError(''); setMode('join') }}>Запросить доступ</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (mode === 'pick') {
    return (
      <div className="screen center">
        <div className="card login-card">
          {mark}
          <h1 className="title">Журнал тренировок</h1>
          {joinCard}
          <div className="user-list">
            {known.map((u) => (
              <button key={u.id} className="user-btn" onClick={() => pickUser(u)}>
                <span className="user-btn-name">{u.name}</span>
                <svg className="user-btn-chev" viewBox="0 0 24 24" width="18" height="18" fill="none"
                  stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            ))}
          </div>
          <div className="login-alt">
            <button className="link-btn" onClick={() => { setError(''); setMode('name') }}>Войти под другим именем</button>
            {!pending && <button className="link-btn" onClick={() => { setError(''); setMode('join') }}>Запросить доступ</button>}
          </div>
        </div>
      </div>
    )
  }

  // mode === 'pin'
  return (
    <div className="screen center">
      <div className="card login-card">
        <div className="login-pin-head">
          <BackButton onClick={goPick} label="Выбрать другого" />
        </div>
        <h2 className="title">{selected.name}</h2>
        <p className="muted login-sub">Введи PIN — 4 цифры</p>

        <div className="pin-dots">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={i < pin.length ? 'dot filled' : 'dot'} />
          ))}
        </div>
        {busy ? (
          <div className="login-busy">
            <span className="spinner" aria-hidden="true" />
            <span>Входим…</span>
          </div>
        ) : (
          error && <p className="error">{error}</p>
        )}

        <div className={busy ? 'keypad dim' : 'keypad'}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button key={n} className="key" disabled={busy} onClick={() => pressDigit(String(n))}>{n}</button>
          ))}
          <span />
          <button className="key" disabled={busy} onClick={() => pressDigit('0')}>0</button>
          <button className="key key-del" disabled={busy} onClick={backspace} aria-label="Стереть">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" /><path d="M17 9.5l-5 5M12 9.5l5 5" />
            </svg>
          </button>
        </div>
        <div className="login-alt">
          <button className={confirmForget ? 'link-btn danger' : 'link-btn'} disabled={busy} onClick={forget}>
            {confirmForget ? 'Точно убрать из списка?' : 'Забыть на этом устройстве'}
          </button>
        </div>
        {confirmForget && (
          <p className="muted invite-note">Тренировки не пропадут — потом войдешь по имени и PIN.</p>
        )}
      </div>
    </div>
  )
}

// Вход по имени + PIN (новое устройство). Только онлайн: хэша учетки тут еще нет.
function NameLoginForm({ onLogin, showError, error, setError }) {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (!name.trim()) { setError('Напиши свое имя.'); return }
    if (pin.length !== 4) { setError('PIN — 4 цифры.'); return }
    if (!navigator.onLine) { setError('Нет сети. Первый вход на устройстве — только онлайн.'); return }
    setBusy(true)
    setError('')
    try {
      const user = await loginByName(name, pin)
      onLogin(user)
    } catch (err) {
      showError(err)
      setPin('')
      setBusy(false)
    }
  }

  return (
    <form className="invite-form" onSubmit={submit} noValidate>
      <label className="field">
        <span className="field-lab">Имя</span>
        <input className="admin-input" type="text" maxLength={60} autoComplete="username" autoCapitalize="words"
          value={name} disabled={busy} onChange={(e) => { setName(e.target.value); setError('') }} />
      </label>
      <label className="field">
        <span className="field-lab">PIN — 4 цифры</span>
        <input className="pin-input" type="password" inputMode="numeric" maxLength={4}
          autoComplete="current-password" placeholder="••••" value={pin} disabled={busy}
          onChange={(e) => { setPin(onlyDigits(e.target.value).slice(0, 4)); setError('') }} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Входим…' : 'Войти'}
      </button>
    </form>
  )
}
