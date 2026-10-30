import { useState, useEffect, useRef } from 'react'
import { getUsers } from '../db/repo.js'
import { migrateLoginZone } from '../db/local.js'
import {
  login as authLogin, verifyPinOffline, dropForeignSession, noteLoginFailure,
  knownAccounts, forgetAccount, LoginError,
} from '../lib/auth.js'
import { useJoinRequest } from '../hooks/useJoinRequest.js'
import AppMark from '../components/app/AppMark.jsx'
import BackButton from '../components/ui/BackButton.jsx'
import JoinRequestForm from '../components/auth/JoinRequestForm.jsx'
import JoinStatusCard from '../components/auth/JoinStatusCard.jsx'
import NameLoginForm from '../components/auth/NameLoginForm.jsx'
import PinPad from '../components/auth/PinPad.jsx'
import ForgotPin from '../components/recovery/ForgotPin.jsx'
import Chevron from '../components/ui/Chevron.jsx'

// Экран входа (v6.12.0).
//   • Пикер показывает ТОЛЬКО учетки, уже входившие на этом устройстве (есть
//     офлайн-кэш PIN). Список всех участников экран больше не запрашивает: кто
//     случайно открыл ссылку на приложение, круг не видит.
//   • Новое устройство (или другой человек) — «Войти по имени»: имя + PIN, онлайн.
//     Сервер прощает регистр, пробелы и знаки и узнает однозначное начало имени.
//   • «Забыть на этом устройстве» — убрать учетку из пикера (на экране PIN).
//   • «Запросить доступ» (до 6.16.0 — «Запросить приглашение», до 6.14.1 — «Попросить приглашение», до 6.13.3 — «Хочу в круг») — заявка владельцу; одобрено → регистрация по приглашению
//     (onInvite(token) → InviteScreen).
//   • «Забыл PIN?» (П1, v6.18.0) — ссылка от бота в Telegram или код восстановления
//     (components/recovery/ForgotPin.jsx), без админа.
// Части экрана (аудит 14.10): заявка и ее опрос — hooks/useJoinRequest.js, ее статус —
// components/auth/JoinStatusCard.jsx, вход по логину — NameLoginForm.jsx, клавиатура PIN —
// PinPad.jsx. Здесь — режимы экрана и проверка PIN (сервер, затем кэш).
// Сколько ждать сервер при входе с пикера, прежде чем открыть приложение по кэшу.
const LOGIN_ONLINE_TIMEOUT_MS = 8000
// Коды LoginError, при которых сервер «не ответил» (а не «отказал»).
const SERVER_DOWN = new Set(['network', 'server'])

export default function LoginScreen({ onLogin, onInvite }) {
  const [known, setKnown] = useState([])
  const [mode, setMode] = useState('loading') // 'loading' | 'pick' | 'pin' | 'name' | 'join' | 'forgot'
  const [selected, setSelected] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmForget, setConfirmForget] = useState(false)
  const join = useJoinRequest(onInvite)
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
    try {
      await forgetAccount(selected.id)
      const list = await reloadKnown()
      setSelected(null); setPin(''); setError(''); setConfirmForget(false)
      setMode(list.length ? 'pick' : 'name')
    } catch {
      // Сбой локальной базы (UI-ревью 23.10): без catch ошибка уходила в никуда, кнопка «молчала».
      setConfirmForget(false)
      setError('Не получилось убрать учетку с устройства. Попробуй еще раз.')
    }
  }

  const mark = <AppMark />

  // Статус заявки «Запросить доступ» (над формами входа).
  const joinCard = (
    <JoinStatusCard
      pending={join.pending}
      joinNote={join.joinNote}
      onInvite={onInvite}
      onCheck={join.checkJoin}
      onForget={join.forget}
      onClearNote={join.clearNote}
    />
  )

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
            onSubmitted={(p) => { join.submitted(p); goPick() }}
          />
        </div>
      </div>
    )
  }

  if (mode === 'forgot') {
    return (
      <div className="screen center">
        <div className="card login-card invite-card">
          {mark}
          <h1 className="title">Забыл PIN</h1>
          <ForgotPin onBack={goPick} onLogin={onLogin} />
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
          <p className="muted login-sub">Введи логин и PIN</p>
          {joinCard}
          <NameLoginForm onLogin={onLogin} showError={showError} error={error} setError={setError} />
          <div className="login-alt">
            <button className="link-btn" onClick={() => { setError(''); setMode('forgot') }}>Забыл PIN?</button>
            {!join.pending && <button className="link-btn" onClick={() => { setError(''); setMode('join') }}>Запросить доступ</button>}
          </div>
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
                <Chevron className="user-btn-chev" size={18} />
              </button>
            ))}
          </div>
          <div className="login-alt">
            <button className="link-btn" onClick={() => { setError(''); setMode('name') }}>Войти в другую учетку</button>
            {!join.pending && <button className="link-btn" onClick={() => { setError(''); setMode('join') }}>Запросить доступ</button>}
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

        <PinPad length={pin.length} busy={busy} error={error} onDigit={pressDigit} onBackspace={backspace} />
        <div className="login-alt">
          <button className="link-btn" disabled={busy} onClick={() => { setError(''); setConfirmForget(false); setMode('forgot') }}>Забыл PIN?</button>
          <button className={confirmForget ? 'link-btn danger' : 'link-btn'} disabled={busy} onClick={forget}>
            {confirmForget ? 'Точно убрать из списка?' : 'Забыть на этом устройстве'}
          </button>
        </div>
        {confirmForget && (
          <p className="muted invite-note">Тренировки не пропадут — потом войдешь по логину и PIN.</p>
        )}
      </div>
    </div>
  )
}
