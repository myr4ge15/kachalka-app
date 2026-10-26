import MenuRow from '../ui/MenuRow.jsx'
import { useRef, useState } from 'react'
import { exportAllMyData, importAllMyData } from '../../db/backup.js'
import { describeImport, BackupError } from '../../lib/backup.js'
import { syncNow } from '../../db/sync.js'
import { APP_VERSION } from '../../lib/appVersion.js'
import { showToast } from '../ui/Toast.jsx'
import { useAliveRef } from '../../hooks/useAliveRef.js'

// Все мои данные: выгрузка и восстановление (Настройки; вынесено из ProfileScreen в
// v6.14.1). Часть личных сущностей (бейджи, настройки прогрессии) живет ТОЛЬКО локально
// и умирает вместе с чисткой браузера — файл-снимок закрывает этот риск.
// Восстановление намеренно ТОЛЬКО ДОБАВЛЯЕТ недостающее: затереть свежие данные старым
// файлом невозможно (см. lib/backup.js planImport). Два пункта списка .actions — фрагмент.
export default function BackupActions({ userId }) {
  const backupInput = useRef(null)
  const aliveRef = useAliveRef()
  const [bkBusy, setBkBusy] = useState(false)

  async function doExportAll() {
    setBkBusy(true)
    try {
      const n = await exportAllMyData(userId, APP_VERSION)
      showToast({ emoji: '💾', title: 'Файл сохранен', sub: `Тренировок в выгрузке: ${n}` })
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось выгрузить', sub: String(e?.message ?? e) })
    } finally {
      if (aliveRef.current) setBkBusy(false)
    }
  }
  async function onPickBackup(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // позволить выбрать тот же файл повторно
    if (!file) return
    setBkBusy(true)
    try {
      const c = await importAllMyData(userId, await file.text())
      showToast({ emoji: '📥', title: 'Восстановлено', sub: describeImport(c) })
      if (c.failed) {
        showToast({ emoji: '⚠️', title: 'Часть записей пропущена', sub: `Не удалось добавить: ${c.failed}` })
      }
      if (navigator.onLine) syncNow(userId) // отправить восстановленное на сервер
    } catch (err) {
      showToast({
        emoji: '⚠️',
        title: err instanceof BackupError ? 'Не тот файл' : 'Не удалось восстановить',
        sub: String(err?.message ?? err),
      })
    } finally {
      if (aliveRef.current) setBkBusy(false)
    }
  }

  return (
    <>
      <MenuRow kind="action" icon="download" title="Скачать все мои данные"
        sub="один JSON: тренировки, цели, достижения, настройки" onClick={doExportAll} disabled={bkBusy} />
      {/* Восстановление — кнопка, которая открывает скрытый выбор файла (UI-ревью 23.10: <label>
          скринридер не читал как кнопку, с клавиатуры не нажимался). */}
      <MenuRow kind="action" icon="upload" title="Восстановить из файла" sub="добавит только то, чего сейчас нет"
        className={bkBusy ? 'busy' : ''} disabled={bkBusy} onClick={() => backupInput.current?.click()} />
      <input
        ref={backupInput}
        type="file"
        accept="application/json,.json"
        onChange={onPickBackup}
        disabled={bkBusy}
        hidden
      />
    </>
  )
}
