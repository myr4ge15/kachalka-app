import { useState } from 'react'

// Статус заявки «Запросить доступ» над формами входа (вынесено из LoginScreen,
// аудит 14.10). Презентационный: заявка и ее опрос — hooks/useJoinRequest.js.
//   pending.token — приняли: «Зарегистрироваться» → onInvite(token);
//   pending       — ждет ответа: «Проверить» / «Отменить заявку»;
//   joinNote = 'declined' — отклонили, заявка уже стерта.
// UI-ревью 23.10: «Проверить» отвечает («Проверяю…» → «Пока без ответа»), «Отменить заявку» — со второго тапа.

export default function JoinStatusCard({ pending, joinNote, onInvite, onCheck, onForget, onClearNote }) {
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const [armCancel, setArmCancel] = useState(false)
  async function check() {
    if (checking) return
    setChecking(true)
    try { await onCheck?.() } catch { /* нет сети — ответ просто не пришел */ }
    setChecking(false)
    setChecked(true)
  }

  if (pending?.token) {
    return (
      <div className="join-status" role="status">
        <p><b>Тебя приняли в круг 🎉</b></p>
        <p className="muted">Осталось придумать логин, PIN и имя.</p>
        <button className="btn primary" onClick={() => onInvite?.(pending.token)}>Зарегистрироваться</button>
        <button className="link-btn" onClick={onForget}>Убрать</button>
      </div>
    )
  }
  if (pending) {
    return (
      <div className="join-status" role="status">
        <p><b>Заявка отправлена</b></p>
        {pending.name && <p className="muted">Имя в заявке: {pending.name}</p>}
        <p className="muted">Как только владелец ответит, приглашение откроется здесь.</p>
        {checked && !checking && <p className="muted">Пока без ответа — загляни позже.</p>}
        <button className="btn ghost" onClick={check} disabled={checking}>{checking ? 'Проверяю…' : 'Проверить'}</button>
        {armCancel ? (
          <div className="btn-row">
            <button className="btn ghost" onClick={() => setArmCancel(false)}>Оставить</button>
            <button className="btn danger" onClick={onForget}>Отменить заявку</button>
          </div>
        ) : (
          <button className="link-btn" onClick={() => setArmCancel(true)}>Отменить заявку</button>
        )}
      </div>
    )
  }
  if (joinNote === 'declined') {
    return (
      <div className="join-status" role="status">
        <p>Владелец пока не принял заявку.</p>
        <button className="link-btn" onClick={onClearNote}>Понятно</button>
      </div>
    )
  }
  return null
}
