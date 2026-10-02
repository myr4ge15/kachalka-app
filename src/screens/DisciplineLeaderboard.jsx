import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getRatingCatalog, getRatingBoard, fetchRatingCatalog, fetchRatingBoard } from '../db/disciplines.js'
import { getCachedUser, getUsers, getPrivacyFlag } from '../db/repo.js'
import { onOnline, onResume } from '../lib/appEvents.js'
import { disciplineGroup, disciplineResult, DISCIPLINE_UNITS } from '../lib/disciplines.js'
import { findNearestRival } from '../lib/rivalry.js'
import { fmtWhen } from '../lib/dates.js'
import Avatar from '../components/Avatar.jsx'
import RivalryCard from '../components/RivalryCard.jsx'
import LegacyLeaderboard from './LegacyLeaderboard.jsx'

const GROUPS = [['m', 'Мужчины'], ['f', 'Женщины'], ['u', 'Пол не указан']]

export default function DisciplineLeaderboard({ user, onOpenMember }) {
  const catalog = useLiveQuery(getRatingCatalog, [], null)
  const myPrivate = useLiveQuery(() => getPrivacyFlag(user.id), [user.id], false)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const items = catalog?.items ?? []
  const discipline = items.find(d => d.id === selected) ?? items[0]
  useEffect(() => {
    let alive = true
    const refresh = () => fetchRatingCatalog(user.id)
      .then(() => { if (alive) setError('') })
      .catch(() => { if (alive) setError('Не удалось обновить дисциплины.') })
    refresh()
    const off1 = onOnline(refresh), off2 = onResume(refresh)
    return () => { alive = false; off1(); off2() }
  }, [user.id])
  if (myPrivate) return null
  // Старый сервер: привычный рейтинг остается до наката SQL.
  if (!catalog) return <LegacyLeaderboard user={user} onOpenMember={onOpenMember} />
  return <section aria-label="Рейтинг по дисциплинам">
    <div className="discipline-tabs" role="group" aria-label="Дисциплина">
      {items.map(d => <button type="button" key={d.id} className={'chip' + (d.id === discipline?.id ? ' active' : '')}
        aria-pressed={d.id === discipline?.id} onClick={() => setSelected(d.id)}>{d.name}</button>)}
    </div>
    {error && <p className="muted" role="status">{error} Показан сохранённый список.</p>}
    {discipline ? <DisciplineBoard key={discipline.id} discipline={discipline} user={user} onOpenMember={onOpenMember} />
      : <div className="card lb-card"><h3 className="lb-title">Рейтинг</h3><p className="muted">Пока нет дисциплин. Администратор может выбрать их в «Дисциплинах рейтинга».</p></div>}
  </section>
}

function DisciplineBoard({ discipline, user, onOpenMember }) {
  const snapshot = useLiveQuery(() => getRatingBoard(discipline), [discipline], null)
  const me = useLiveQuery(() => getCachedUser(user.id), [user.id], null)
  const users = useLiveQuery(getUsers, [], [])
  const avatars = useMemo(() => new Map(users.map(u => [u.id, u.avatar_url])), [users])
  const [chosenGroup, setChosenGroup] = useState(null)
  const group = discipline.split_by_sex ? chosenGroup ?? disciplineGroup(me?.sex) : 'all'
  const rows = (snapshot?.rows ?? []).filter(r => r.board === group)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const metric = discipline.metric
  useEffect(() => {
    let alive = true
    const refresh = async () => {
      if (alive) setBusy(true)
      try { await fetchRatingBoard(user.id, discipline); if (alive) setError('') }
      catch { if (alive) setError('Не удалось обновить рейтинг.') }
      finally { if (alive) setBusy(false) }
    }
    refresh()
    const off1 = onOnline(refresh), off2 = onResume(refresh)
    return () => { alive = false; off1(); off2() }
  }, [user.id, discipline])
  const rivalry = findNearestRival(rows, user.id, metric)
  return <>
    <div className="card lb-card">
      <div className="lb-head"><h3 className="lb-title">{discipline.name}</h3><span className="muted lb-metric">{DISCIPLINE_UNITS[metric]}</span></div>
      {discipline.split_by_sex && <div className="discipline-groups seg" role="group" aria-label="Участники рейтинга">
        {GROUPS.map(([key, label]) => <button key={key} type="button" className={'seg-item' + (key === group ? ' on' : '')}
          aria-pressed={key === group} onClick={() => setChosenGroup(key)}>{label}</button>)}
      </div>}
      {error && <p className="muted" role="status">{error}{snapshot ? ' Показаны сохранённые результаты.' : ''}</p>}
      {!rows.length && <p className="muted lb-empty" role="status">{!snapshot
        ? busy ? 'Загружаем рейтинг…' : 'Рейтинг ещё не загружен. Подключись к сети.'
        : 'Пока нет результатов. Запиши подход в этом упражнении.'}</p>}
      <ol className="lb-list">
        {rows.map((row, i) => <li key={row.user_id} className={'lb-row lb-row-link' + (row.user_id === user.id ? ' me' : '')} data-anchor={`lb-${row.user_id}`}>
          <button type="button" className="lb-row-hit" onClick={() => onOpenMember?.(row.user_id, `lb-${row.user_id}`)} aria-label={`Открыть профиль: ${row.user_name}`}>
            <span className={'lb-place' + (i < 3 ? ` lb-place--${['gold', 'silver', 'bronze'][i]}` : '')}>{i + 1}</span>
            <Avatar name={row.user_name} url={avatars.get(row.user_id)} className="avatar-sm" />
            <span className="lb-who"><span className="lb-name">{row.user_name}</span>{row.user_id === user.id && <span className="feed-me">я</span>}</span>
            <span className="lb-fact"><span className="lb-weight">{disciplineResult(metric, row.value)}</span>
              <span className="lb-sub muted">{metric === 'weight' ? `${row.reps} повт.${row.orm > 0 ? ` · 1ПМ ~${row.orm}` : ''}` : fmtWhen(row.performed_at)}</span>
            </span>
          </button>
        </li>)}
      </ol>
      <p className="muted lb-note">Лучший подход за всё время.{metric === 'weight' ? ' При равном весе выше результат с большим числом повторов. 1ПМ — справочно.' : ' Больше — выше.'} При равенстве — кто достиг раньше.</p>
      {snapshot && <p className="muted lb-note">{navigator.onLine ? 'Обновлено' : 'Без сети · сохранено'} {fmtWhen(snapshot.fetchedAt)}</p>}
    </div>
    <RivalryCard key={group} rivalry={rivalry} avatarById={avatars} />
  </>
}
