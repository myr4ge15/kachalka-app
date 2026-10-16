// Статус заявки «Запросить доступ» над формами входа (вынесено из LoginScreen,
// аудит 14.10). Презентационный: заявка и ее опрос — hooks/useJoinRequest.js.
//   pending.token — приняли: «Зарегистрироваться» → onInvite(token);
//   pending       — ждет ответа: «Проверить» / «Отменить заявку»;
//   joinNote = 'declined' — отклонили, заявка уже стерта.
export default function JoinStatusCard({ pending, joinNote, onInvite, onCheck, onForget, onClearNote }) {
  if (pending?.token) {
    return (
      <div className="join-status" role="status">
        <p><b>Тебя приняли в круг 🎉</b></p>
        <p className="muted">Осталось придумать PIN и войти.</p>
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
        <button className="btn ghost" onClick={onCheck}>Проверить</button>
        <button className="link-btn" onClick={onForget}>Отменить заявку</button>
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
