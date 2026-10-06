import { useState } from 'react'
import { exportAllMyData, importAllMyData } from '../../db/backup.js'
import { describeImport, BackupError } from '../../lib/backup.js'
import { syncNow } from '../../db/sync.js'
import { APP_VERSION } from '../../lib/appVersion.js'
import { showToast } from '../Toast.jsx'
import { useAliveRef } from '../../hooks/useAliveRef.js'

// Все мои данные: выгрузка и восстановление (Настройки; вынесено из ProfileScreen в
// v6.14.1). Часть личных сущностей (бейджи, настройки прогрессии) живет ТОЛЬКО локально
// и умирает вместе с чисткой браузера — файл-снимок закрывает этот риск.
// Восстановление намеренно ТОЛЬКО ДОБАВЛЯЕТ недостающее: затереть свежие данные старым
// файлом невозможно (см. lib/backup.js planImport). Два пункта списка .actions — фрагмент.
export default function BackupActions({ userId }) {
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
      <button className="act" onClick={doExportAll} disabled={bkBusy}>
        <span className="act-txt">
          💾 Скачать все мои данные
          <span className="act-sub">один JSON: тренировки, цели, достижения, настройки</span>
        </span>
      </button>
      {/* Восстановление — <label> вместо <button>: нативный выбор файла, как
          у смены аватара. Стиль .act работает и на label. */}
      <label className={'act' + (bkBusy ? ' busy' : '')}>
        <span className="act-txt">
          📥 Восстановить из файла
          <span className="act-sub">добавит только то, чего сейчас нет</span>
        </span>
        <input
          type="file"
          accept="application/json,.json"
          onChange={onPickBackup}
          disabled={bkBusy}
          hidden
        />
      </label>
    </>
  )
}
