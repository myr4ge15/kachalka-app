import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCachedLeaderboard, fetchLeaderboard, getLeadExerciseNames } from '../db/leaderboard.js'
import { getUsers } from '../db/repo.js'
import { getMeta } from '../db/local.js'
import { onOnline, onResume } from '../lib/appEvents.js'
import Avatar from './../components/Avatar.jsx'

// Медаль для тройки призёров, дальше — номер места.
function place(i) {
  return ['🥇', '🥈', '🥉'][i] ?? `${i + 1}`
}

// Лидерборд (ТЗ §4.3, §8.3) — два борда по полу (v1.13.0).
// Мужской — по жиму лёжа (`is_bench_lift`), женский — по ягодичному мостику
// (`is_female_lift`). Место — по ФАКТИЧЕСКОМУ макс. весу, расчётный 1ПМ (Эпли) —
// сноской. Самодостаточен: сам тянет и кэширует данные. Пол участника — users.sex
// (неизвестный → мужской борд). У девушек жим в рейтинге не показывается.
export default function Leaderboard({ user }) {
  // Приватный пользователь не участвует в рейтинге — блок прячем целиком (флаг
  // кэшируется на pull в meta `priv_${id}`, см. sync.js / my_is_private).
  const myPrivate = useLiveQuery(() => getMeta(`priv_${user.id}`), [user.id], false)
  const board = useLiveQuery(() => getCachedLeaderboard(), [], undefined)
  const names = useLiveQuery(() => getLeadExerciseNames(), [], null)
  const users = useLiveQuery(() => getUsers(), [], [])
  const avatarById = useMemo(() => {
    const m = new Map()
    for (const u of users ?? []) m.set(u.id, u.avatar_url)
    return m
  }, [users])
  const [error, setError] = useState(null)

  // Обновляем при входе на экран и появлении сети. Ошибку НЕ глотаем молча:
  // логируем и кладём в state. Частая причина — не задеплоен RPC
  // `leaderboard_bench`; тогда рейтинг всё равно посчитается фолбэком из кэша
  // Ленты (см. getCachedLeaderboard), поэтому баннер показываем только когда
  // показать нечего (см. ниже). Подписки — через общий хаб (lib/appEvents.js).
  useEffect(() => {
    const refresh = () => {
      if (!navigator.onLine) return
      fetchLeaderboard()
        .then(() => setError(null))
        .catch((err) => {
          console.warn('Лидерборд: обновление с сервера не удалось', err)
          setError(err?.message ?? String(err))
        })
    }
    refresh()
    const off1 = onResume(refresh)
    const off2 = onOnline(refresh)
    return () => { off1(); off2() }
  }, [])

  // Приватный — рейтинг не показываем вовсе.
  if (myPrivate) return null
  // Пока читаем кэш — ничего не мигаем.
  if (board === undefined) return null

  const male = board.male ?? []
  const female = board.female ?? []

  // Совсем нет данных — компактная карточка-заглушка (видимое состояние вместо
  // молчаливого null, иначе пустой рейтинг выглядит как «фичи нет»).
  if (male.length === 0 && female.length === 0) {
    return (
      <div className="card lb-card">
        <div className="lb-head">
          <h3 className="lb-title">🏋️ Лидерборд · жим лёжа</h3>
          <span className="muted lb-metric">факт, кг</span>
        </div>
        {error ? (
          <p className="muted lb-empty">Не удалось загрузить рейтинг. Проверь соединение и попробуй позже.</p>
        ) : (
          <p className="muted lb-empty">Пока нет данных — запиши подход в жиме лёжа или ягодичном мостике.</p>
        )}
      </div>
    )
  }

  return (
    <>
      {male.length > 0 && (
        <BoardCard
          title={`🏋️ Лидерборд · ${names?.male ?? 'жим лёжа'}`}
          rows={male}
          user={user}
          avatarById={avatarById}
        />
      )}
      {female.length > 0 && (
        <BoardCard
          title={`🍑 Лидерборд · ${names?.female ?? 'ягодичный мостик'}`}
          rows={female}
          user={user}
          avatarById={avatarById}
        />
      )}
    </>
  )
}

// Одна карточка рейтинга (мужской или женский борд). Разметка/классы — как были,
// чтобы стили (index.css .lb-*) переиспользовались без правок.
function BoardCard({ title, rows, user, avatarById }) {
  return (
    <div className="card lb-card">
      <div className="lb-head">
        <h3 className="lb-title">{title}</h3>
        <span className="muted lb-metric">1ПМ</span>
      </div>
      <ol className="lb-list">
        {rows.map((row, i) => {
          const isMe = row.user_id === user.id
          return (
            <li key={row.user_id} className={isMe ? 'lb-row me' : 'lb-row'}>
              <span className="lb-place">{place(i)}</span>
              <Avatar name={row.user_name} url={avatarById.get(row.user_id)} className="avatar-sm" />
              <span className="lb-who">
                <span className="lb-name">{row.user_name}</span>
                {isMe && <span className="feed-me">ты</span>}
              </span>
              <span className="lb-fact">
                <span className="lb-weight">{row.weight} кг</span>
                <span className="lb-sub muted">{row.reps} повт · 1ПМ ~{row.orm}</span>
              </span>
            </li>
          )
        })}
      </ol>
      <p className="muted lb-note">
        Место — по фактическому весу. 1ПМ — расчётная оценка «на раз» (Эпли),
        всегда ≥ факта: видно, кто в теории может выжать больше.
      </p>
    </div>
  )
}
