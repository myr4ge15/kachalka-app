import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { deadLetterCount, retryDeadLetter, discardDeadLetter } from '../../db/repo.js'
import { syncNow } from '../../db/sync.js'
import { showToast } from '../Toast.jsx'
import { useAliveRef } from '../../hooks/useAliveRef.js'

// Застрявшие изменения (dead-letter) — операции, провалившие все попытки отправки.
// Обычно — затянувшийся холодный старт/обрыв; даем пересобрать или отклонить, чтобы
// не копились молча. Важный алерт: виден и в Профиле, и в Настройках (до v6.14.1
// разметка была продублирована в ProfileScreen дословно — теперь один компонент).
export default function DeadLetterAlert({ userId }) {
  const aliveRef = useAliveRef()
  const deadCount = useLiveQuery(() => deadLetterCount(), [], 0)
  const [dlBusy, setDlBusy] = useState(false)
  const [dlArm, setDlArm] = useState(false) // подтверждение «отклонить» (теряет правки)

  async function retryDead() {
    setDlBusy(true)
    try {
      const n = await retryDeadLetter()
      showToast({ emoji: '🔄', title: 'Повторная отправка', sub: `Операций в очереди: ${n}` })
      if (navigator.onLine) syncNow(userId)
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: String(e?.message ?? e) })
    } finally {
      if (aliveRef.current) setDlBusy(false)
    }
  }
  async function discardDead() {
    setDlBusy(true)
    try {
      const n = await discardDeadLetter()
      if (aliveRef.current) setDlArm(false)
      showToast({ emoji: '🧹', title: 'Изменения отклонены', sub: `Удалено операций: ${n}` })
      if (navigator.onLine) syncNow(userId)
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: String(e?.message ?? e) })
    } finally {
      if (aliveRef.current) setDlBusy(false)
    }
  }

  if (!(deadCount > 0)) return null
  return (
    <div className="danger-confirm">
      <p className="danger-text">
        ⚠️ Не удалось отправить изменений: {deadCount}. Обычно помогает повторить
        (например, после восстановления связи).
      </p>
      {dlArm ? (
        <div className="danger-actions">
          <button className="btn ghost" onClick={() => setDlArm(false)} disabled={dlBusy}>Отмена</button>
          <button className="btn danger" onClick={discardDead} disabled={dlBusy}>
            {dlBusy ? 'Отклоняю…' : 'Да, отклонить (потерять правки)'}
          </button>
        </div>
      ) : (
        <div className="danger-actions">
          <button className="btn primary" onClick={retryDead} disabled={dlBusy}>
            {dlBusy ? 'Отправляю…' : '🔄 Повторить отправку'}
          </button>
          <button className="btn ghost" onClick={() => setDlArm(true)} disabled={dlBusy}>Отклонить</button>
        </div>
      )}
    </div>
  )
}
