import { useCallback, useEffect, useState } from 'react'
import { fetchDomainMigrationStatus } from '../../db/domainMigrationStatus.js'
import { migrationSummary, MIGRATION_STATES } from '../../lib/domainMigrationStatus.js'
import { useAliveRef } from '../../hooks/useAliveRef.js'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import MenuRow from '../ui/MenuRow.jsx'
import Icon from '../ui/Icon.jsx'

function time(value) {
  return value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : 'нет отметки'
}

export default function DomainMigrationSection({ userId, online }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const revealRef = useRevealFocus(expanded)
  const toggle = (id) => setExpanded((current) => current === id ? null : id)
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
    <div className="btn-row migration-tools">
      <button type="button" className="btn ghost" onClick={load} disabled={!online || busy}>
        <Icon name="refresh" size={16} />{busy ? 'Загружаем…' : 'Обновить статусы'}
      </button>
    </div>
    {!online && <p role="status">Нет сети. Подключись, чтобы проверить статусы.</p>}
    {error && <p role="alert">{error}</p>}
    {online && rows && <>
      <div className="migration-summary" role="status" aria-label="Сводка переезда">
        <div><strong>{rows.filter((r) => migrationSummary(r.devices).newSeen).length}/{rows.length}</strong><span>На новом</span></div>
        <div><strong>{rows.filter((r) => migrationSummary(r.devices).recentOld).length}</strong><span>Старый за 7 дней</span></div>
        <div><strong>{rows.filter((r) => migrationSummary(r.devices).oldReady).length}</strong><span>На старом сохранено</span></div>
      </div>
      {rows.length === 0 && <p>Участников пока нет.</p>}
      <div className="menu-group migration-status-list">
        {rows.map((row) => {
          const summary = migrationSummary(row.devices)
          const newAt = row.devices.filter((d) => d.domain === 'new').map((d) => d.last_seen_at).sort().at(-1)
          const oldAt = summary.old.map((d) => d.last_seen_at).sort().at(-1)
          const open = expanded === row.user_id
          const sub = row.devices.length === 0 ? 'Еще нет отметок'
            : [summary.newSeen ? 'Заходил на новый' : 'Новый не отмечался',
              summary.oldReady ? 'На старом сохранено' : summary.old.length ? 'Старый: нужна проверка' : 'Старый не отмечался'].join(' · ')
          return <article className="migration-person" key={row.user_id} aria-label={row.name} ref={open ? revealRef : null}>
            <MenuRow kind="expand" title={row.name} sub={sub} open={open} onClick={() => toggle(row.user_id)}
              aria-controls={`migration-details-${row.user_id}`} />
            {open && <div className="migration-details" id={`migration-details-${row.user_id}`} role="region" aria-label={`Подробности: ${row.name}`}>
            {row.devices.length === 0 ? <p className="admin-hint">Пока нет отметок от обновленного приложения на этой учетке.</p> : <>
            <dl>
              <div><dt>Новый адрес</dt><dd>{summary.newSeen ? `Был вход · ${time(newAt)}` : 'Пока нет данных'}</dd></div>
              <div><dt>Старый адрес</dt><dd>{oldAt ? `${summary.recentOld ? 'Был за последние 7 дней' : 'Давняя активность'} · ${time(oldAt)}` : 'Пока нет данных'}</dd></div>
              <div><dt>Сохранение на старом</dt><dd>{summary.oldReady ? 'Все сохранено на последних проверках известных устройств' : summary.old.length ? 'Не на всех известных устройствах подтверждено' : 'Пока нет данных'}</dd></div>
            </dl>
            {summary.old.map((d, index) => <p className="admin-hint" key={d.device_id}>
              {d.device_label} · устройство {index + 1}: {MIGRATION_STATES[d.save_state] ?? MIGRATION_STATES.unknown}.
              {' '}Проверка: {time(d.checked_at)}. Версия: {d.version}.
            </p>)}
            </>}
            </div>}
          </article>
        })}
      </div>
    </>}
    <div className="menu-group migration-help" ref={expanded === 'help' ? revealRef : null}>
      <MenuRow kind="expand" icon="info" title="Как читать статусы" open={expanded === 'help'}
        onClick={() => toggle('help')} aria-controls="migration-help" />
      {expanded === 'help' && <div className="migration-details" id="migration-help">
        <p className="admin-hint">Отметки собираются с версии 1.10.0. Старые версии и устройства, которые еще не открывали приложение, здесь не учтены. Старый адрес продолжает работать.</p>
        <p className="admin-hint">«Все сохранено» — снимок после успешной синхронизации, без очередей и черновиков, для этой учетки на известных старых устройствах. Проверь время: после него могли появиться новые правки.</p>
      </div>}
    </div>
  </>
}
