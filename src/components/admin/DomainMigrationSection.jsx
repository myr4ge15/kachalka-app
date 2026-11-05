import { useCallback, useEffect, useState } from 'react'
import { fetchDomainMigrationStatus } from '../../db/domainMigrationStatus.js'
import { migrationSummary, MIGRATION_STATES } from '../../lib/domainMigrationStatus.js'
import { useAliveRef } from '../../hooks/useAliveRef.js'
import MenuRow from '../ui/MenuRow.jsx'

function time(value) {
  return value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : 'нет отметки'
}

export default function DomainMigrationSection({ userId, online }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useAliveRef()
  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const result = await fetchDomainMigrationStatus(userId)
      if (alive.current) setRows(result)
    } catch (e) {
      if (alive.current) { setRows(null); setError(e.message) }
    } finally { if (alive.current) setBusy(false) }
  }, [userId, alive])
  useEffect(() => { if (online) load() }, [online, load])

  return <>
    <p className="admin-hint">Отметки собираются с версии 1.10.0. Старые версии и устройства, которые еще не открывали приложение, здесь не учтены. Старый адрес продолжает работать.</p>
    <p className="admin-hint">«Все сохранено» — снимок после успешной синхронизации, без очередей и черновиков, для этой учетки на известных старых устройствах. Проверь время: после него могли появиться новые правки.</p>
    <div className="menu-group">
      <MenuRow kind="action" icon="refresh" title={busy ? 'Загружаем статусы…' : 'Обновить статусы'} onClick={load} disabled={!online || busy} />
    </div>
    {!online && <p role="status">Нет сети. Подключись, чтобы проверить статусы.</p>}
    {error && <p role="alert">{error}</p>}
    {online && rows && <>
      <p className="admin-hint" role="status">Заходили на новый: {rows.filter((r) => migrationSummary(r.devices).newSeen).length} из {rows.length}. Старый за 7 дней: {rows.filter((r) => migrationSummary(r.devices).recentOld).length}.</p>
      {rows.length === 0 && <p>Участников пока нет.</p>}
      <div className="migration-status-list">
        {rows.map((row) => {
          const summary = migrationSummary(row.devices)
          const newAt = row.devices.filter((d) => d.domain === 'new').map((d) => d.last_seen_at).sort().at(-1)
          const oldAt = summary.old.map((d) => d.last_seen_at).sort().at(-1)
          return <article className="card migration-status-card" key={row.user_id} aria-label={row.name}>
            <h3>{row.name}</h3>
            <dl>
              <div><dt>Новый адрес</dt><dd>{summary.newSeen ? `Был вход · ${time(newAt)}` : 'Пока нет данных'}</dd></div>
              <div><dt>Старый адрес</dt><dd>{oldAt ? `${summary.recentOld ? 'Был за последние 7 дней' : 'Давняя активность'} · ${time(oldAt)}` : 'Пока нет данных'}</dd></div>
              <div><dt>Сохранение на старом</dt><dd>{summary.oldReady ? 'Все сохранено на последних проверках известных устройств' : summary.old.length ? 'Не на всех известных устройствах подтверждено' : 'Пока нет данных'}</dd></div>
            </dl>
            {summary.old.map((d, index) => <p className="admin-hint" key={d.device_id}>
              {d.device_label} · устройство {index + 1}: {MIGRATION_STATES[d.save_state] ?? MIGRATION_STATES.unknown}.
              {' '}Проверка: {time(d.checked_at)}. Версия: {d.version}.
            </p>)}
          </article>
        })}
      </div>
    </>}
  </>
}
