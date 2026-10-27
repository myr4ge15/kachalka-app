import MenuRow from '../ui/MenuRow.jsx'
import { useState } from 'react'
import { softDeleteMyWorkouts } from '../../db/repo.js'
import { clearMyBody } from '../../db/body.js'
import { syncNow } from '../../db/sync.js'
import { showToast } from '../ui/Toast.jsx'
import { useAliveRef } from '../../hooks/useAliveRef.js'

// «Удалить мои данные» (фаза 2c, soft-delete; вынесено из ProfileScreen в v6.14.1).
// Подтверждение живет здесь же: закрытие Настроек размонтирует блок и снимает его.
export default function DeleteMyData({ userId }) {
  const aliveRef = useAliveRef()
  const [delArm, setDelArm] = useState(false)
  const [delBusy, setDelBusy] = useState(false)

  async function confirmDelete() {
    setDelBusy(true)
    try {
      const n = await softDeleteMyWorkouts(userId)
      await clearMyBody(userId) // и записи «Вес и замеры» (надгробиями — второе устройство их не вернет)
      if (aliveRef.current) setDelArm(false)
      showToast({
        icon: 'trash',
        title: 'Данные удалены',
        sub: n ? `Помечено тренировок: ${n}` : 'Удалять было нечего.',
      })
      if (navigator.onLine) syncNow(userId) // отправить удаления на сервер
    } catch (e) {
      showToast({ icon: 'alert', title: 'Не удалось удалить', sub: String(e?.message ?? e) })
    } finally {
      if (aliveRef.current) setDelBusy(false)
    }
  }

  if (!delArm) {
    return <MenuRow kind="action" tone="danger" icon="trash" title="Удалить мои данные" onClick={() => setDelArm(true)} />
  }
  return (
    <div className="danger-confirm">
      <p className="danger-text">
        Удалить все свои тренировки и записи веса и замеров? Отменить это нельзя — если не уверен,
        сначала нажми «Скачать все мои данные». Учетная запись, цели упражнений и шаблоны останутся.
      </p>
      <div className="danger-actions">
        <button className="btn ghost" onClick={() => setDelArm(false)} disabled={delBusy}>Отмена</button>
        <button className="btn danger" onClick={confirmDelete} disabled={delBusy}>
          {delBusy ? 'Удаляю…' : 'Да, удалить'}
        </button>
      </div>
    </div>
  )
}
