import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCachedLeaderboard, fetchLeaderboard, getLeadExerciseNames, viewerBoard } from '../db/leaderboard.js'
import { getUsers, getCachedUser } from '../db/repo.js'
import { getMeta } from '../db/local.js'
import { onOnline, onResume } from '../lib/appEvents.js'
import Avatar from './../components/Avatar.jsx'
import Skeleton from '../components/Skeleton.jsx'
import CardsSkeleton from '../components/CardsSkeleton.jsx'

// Медаль для тройки призёров, дальше — номер места.
function place(i) {
  return ['🥇', '🥈', '🥉'][i] ?? `${i + 1}`
}

// Лидерборд (ТЗ §4.3, §8.3) — борд по полу зрителя (v1.13.1).
// Мужской — по жиму лёжа (`is_bench_lift`), женский — по ягодичному мостику
// (`is_female_lift`). Зритель видит ТОЛЬКО свой борд: мужчинам (и не заданному
// полу) — мужской, женщинам — женский (чужой борд не показываем). Место — по
// ФАКТИЧЕСКОМУ макс. весу, расчётный 1ПМ (Эпли) — сноской. Самодостаточен: сам
// тянет и кэширует данные. Пол зрителя — users.sex из кэша (getCachedUser).
export default function Leaderboard({ user }) {
  // Приватный пользователь не участвует в рейтинге — блок прячем целиком (флаг
  // кэшируется на pull в meta `priv_${id}`, см. sync.js / my_is_private).
  const myPrivate = useLiveQuery(() => getMeta(`priv_${user.id}`), [user.id], false)
  const board = useLiveQuery(() => getCachedLeaderboard(), [], undefined)
  const names = useLiveQuery(() => getLeadExerciseNames(), [], null)
  const users = useLiveQuery(() => getUsers(), [], [])
  // Пол зрителя — чтобы показать только его борд. Дефолт false = «ещё грузим»
  // (отличаем от undefined «строки нет в кэше» → фолбэк в мужской борд).
  const meRow = useLiveQuery(() => getCachedUser(user.id), [user.id], false)
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
  // Пока читаем кэш (рейтинг или свой профиль) — каркас вместо пустоты/мигания.
  if (board === undefined || meRow === false) {
    return (
      <div className="card lb-card" aria-busy="true" aria-label="Загрузка">
        <Skeleton w="55%" h={18} r={6} style={{ marginBottom: 12 }} />
        <CardsSkeleton cards={4} height={34} />
      </div>
    )
  }

  // Показываем ТОЛЬКО борд зрителя по его полу: женщине — женский (мостик),
  // мужчине и не заданному полу — мужской (жим). Чужой борд не показываем.
  const isFemaleViewer = viewerBoard(meRow?.sex) === 'f'
  const rows = (isFemaleViewer ? board.female : board.male) ?? []
  const title = isFemaleViewer
    ? `🍑 Лидерборд · ${names?.female ?? 'ягодичный мостик'}`
    : `🏋️ Лидерборд · ${names?.male ?? 'жим лёжа'}`

  // Нет данных в своём борде — компактная карточка-заглушка (видимое состояние
  // вместо молчаливого null, иначе пустой рейтинг выглядит как «фичи нет»).
  if (rows.length === 0) {
    // Баннер ошибки — ТОЛЬКО когда не загрузилось вообще ничего (пусты оба борда).
    // Если чужой борд наполнен, значит снимок/фолбэк работают, а свой борд просто
    // пуст (нет своих подходов) — показываем «пока нет данных», а не ошибку сети.
    const nothingLoaded = (board.male?.length ?? 0) === 0 && (board.female?.length ?? 0) === 0
    return (
      <div className="card lb-card">
        <div className="lb-head">
          <h3 className="lb-title">{title}</h3>
          <span className="muted lb-metric">факт, кг</span>
        </div>
        {error && nothingLoaded ? (
          <p className="muted lb-empty">Не удалось загрузить рейтинг. Проверь соединение и попробуй позже.</p>
        ) : (
          <p className="muted lb-empty">
            Пока нет данных — запиши подход в {isFemaleViewer ? 'ягодичном мостике' : 'жиме лёжа'}.
          </p>
        )}
      </div>
    )
  }

  return <BoardCard title={title} rows={rows} user={user} avatarById={avatarById} />
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
