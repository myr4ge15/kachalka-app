import { useState, useEffect, useRef } from 'react'
import { supabase } from '../db/supabase.js'
import { getUsers, cacheUsers } from '../db/repo.js'
import { migrateLoginZone } from '../db/local.js'
import { login as authLogin, verifyPinOffline, dropForeignSession, LoginError } from '../lib/auth.js'
import { withTimeout } from '../lib/withTimeout.js'
import Avatar from '../components/Avatar.jsx'
import BackButton from '../components/BackButton.jsx'

export default function LoginScreen({ onLogin }) {
  const [users, setUsers] = useState([])
  const [selected, setSelected] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  // Синхронный замок «попытка в полёте»: setBusy(true) применяется асинхронно,
  // поэтому гонка backspace+перенабор до 4 цифр могла вызвать submit() дважды до
  // ре-рендера (лишняя попытка → инфляция серверного счётчика блокировки). Ref
  // меняется синхронно и не зависит от тайминга коммита состояния.
  const inFlight = useRef(false)

  // Имена для пикера: сначала из кэша (IndexedDB) — мгновенно и офлайн, затем
  // тихо обновляем из login_users (view БЕЗ хэшей/соли/роли, доступен анониму).
  // PIN здесь больше не тянем: сверка идёт в auth-login (онлайн) либо по
  // локальному кэшу своего хэша (офлайн, verifyPinOffline).
  useEffect(() => {
    let alive = true
    async function load() {
      // Перенос «загрузочной зоны» со старой общей базы (ростер + офлайн-кэш PIN),
      // чтобы пикер и офлайн-вход пережили апдейт на персональные базы. Идемпотентно.
      await migrateLoginZone()
      const cached = await getUsers()
      if (alive && cached.length) {
        setUsers(cached)
        setLoading(false)
      }
      try {
        // withTimeout: подвисшая сеть иначе держала экран на «Загрузка…» ~минуту
        // (запрос без таймаута). При наличии кэша список уже показан выше —
        // обновление просто тихо отвалится по таймауту.
        // sex тянем вместе с остальным: кэш ростера — источник пола для рейтинга
        // (getCachedUser → viewerBoard), и на новом устройстве до первого pull
        // другого источника нет. Раньше его тут не было, и запись кэша обнуляла пол
        // всем учёткам устройства (инцидент 29.07.2026, см. lib/roster.js).
        // Фолбэк на выборку без sex — как в pullGoal: на сервере со старой
        // редакцией вью login_users select упал бы, и устройство без кэша осталось
        // бы вовсе без ростера, а это единственная точка входа в приложение.
        const roster = (fields) => withTimeout(
          supabase
            .from('login_users')
            .select(fields)
            .order('sort_order', { nullsFirst: false })
            .order('id')
        )
        let { data, error } = await roster('id, name, avatar_url, sort_order, sex')
        if (error) ({ data, error } = await roster('id, name, avatar_url, sort_order'))
        if (error) throw error
        if (data) {
          await cacheUsers(data)
          if (alive) setUsers(data)
        }
      } catch (err) {
        if (alive && cached.length === 0) {
          setError(
            'Не удалось загрузить пользователей и нет офлайн-кэша. ' +
              'Подключись к сети хотя бы раз: ' + (err.message ?? err)
          )
        }
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [])

  function pickUser(u) {
    setSelected(u)
    setPin('')
    setError('')
  }

  function pressDigit(d) {
    if (busy || pin.length >= 4) return
    setError('')
    setPin(pin + d)
  }

  function backspace() {
    if (busy) return
    setPin(pin.slice(0, -1))
  }

  async function submit() {
    if (pin.length !== 4 || !selected || busy || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      // 1) Офлайн-разблокировка по локальному кэшу своего хэша (мгновенно).
      //    offline: {id,name,role} — кэш есть и PIN совпал;
      //             false          — кэш есть, но PIN не совпал;
      //             null           — кэша нет (первый вход на устройстве).
      const offline = await verifyPinOffline(selected.id, pin)
      if (offline) {
        // Чужую сессию, оставшуюся на устройстве, снимаем ДО входа: её SIGNED_OUT
        // должен отработать, пока App ещё на экране входа, а не выкинуть нас позже.
        await dropForeignSession(selected.id)
        // UI открываем сразу; если есть сеть — молча перевыпускаем сессию.
        if (navigator.onLine) authLogin(selected.id, pin).catch(() => {})
        onLogin(offline)
        return
      }

      // 2) Кэш не подошёл (false) или его нет (null). Офлайн — судим по локальному
      //    вердикту: промах кэша → «Неверный PIN», отсутствие кэша → нужна сеть.
      if (!navigator.onLine) {
        setError(
          offline === false
            ? 'Неверный PIN'
            : 'Нет сети, а на этом устройстве ещё не входили. Подключись к сети для первого входа.'
        )
        setPin('')
        return
      }

      // 3) Онлайн — сверяем PIN на сервере, НЕ отбивая по устаревшему кэшу. Это чинит
      //    «новый PIN после смены не заходит» (старый локальный хэш давал false):
      //    успех authLogin перезапишет кэш свежим хэшем. Реально неверный PIN придёт
      //    как LoginError('invalid') → «Неверный PIN» (обработка в catch ниже).
      const user = await authLogin(selected.id, pin)
      onLogin(user)
    } catch (e) {
      if (e instanceof LoginError && e.code === 'locked') {
        const mins = e.retryAfter ? Math.ceil(e.retryAfter / 60) : null
        setError(mins ? `Слишком много попыток. Попробуй через ${mins} мин.` : 'Слишком много попыток. Подожди немного.')
      } else if (e instanceof LoginError) {
        setError(e.message)
      } else {
        setError('Ошибка входа: ' + (e?.message ?? e))
      }
      setPin('')
    } finally {
      setBusy(false)
      inFlight.current = false
    }
  }

  // Автопроверка при вводе 4-й цифры
  useEffect(() => {
    if (pin.length === 4) submit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  if (loading) {
    return <div className="screen center"><p className="muted">Загрузка…</p></div>
  }

  if (!selected) {
    return (
      <div className="screen center">
        <div className="card login-card">
          {/* Знак приложения + заголовок (v6.2.1, редизайн «Спорт-блоки»). */}
          <div className="login-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round"><rect x="2" y="8" width="4" height="8" rx="1.5" />
              <rect x="18" y="8" width="4" height="8" rx="1.5" /><path d="M6 12h12" /></svg>
          </div>
          <h1 className="title">Журнал тренировок</h1>
          <p className="muted login-sub">Выбери себя</p>
          <div className="user-list">
            {users.map((u) => (
              <button key={u.id} className="user-btn" onClick={() => pickUser(u)}>
                <span className="user-btn-ava" aria-hidden="true">
                  <Avatar name={u.name} url={u.avatar_url} className="avatar" />
                </span>
                <span className="user-btn-name">{u.name}</span>
                <svg className="user-btn-chev" viewBox="0 0 24 24" width="18" height="18" fill="none"
                  stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            ))}
            {users.length === 0 && (
              <p className="muted">Список пуст. Заполни таблицу users (seed.sql).</p>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="screen center">
      <div className="card login-card">
        <div className="login-pin-head">
          <BackButton onClick={() => setSelected(null)} label="Выбрать другого" />
        </div>
        <span className="login-avatar" aria-hidden="true">
          <Avatar name={selected.name} url={selected.avatar_url} className="avatar-lg" />
        </span>
        <h2 className="title">{selected.name}</h2>
        <p className="muted login-sub">Введи PIN — 4 цифры</p>

        <div className="pin-dots">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={i < pin.length ? 'dot filled' : 'dot'} />
          ))}
        </div>
        {busy ? (
          <div className="login-busy">
            <span className="spinner" aria-hidden="true" />
            <span>Входим…</span>
          </div>
        ) : (
          error && <p className="error">{error}</p>
        )}

        <div className={busy ? 'keypad dim' : 'keypad'}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button key={n} className="key" disabled={busy} onClick={() => pressDigit(String(n))}>{n}</button>
          ))}
          <span />
          <button className="key" disabled={busy} onClick={() => pressDigit('0')}>0</button>
          <button className="key key-del" disabled={busy} onClick={backspace}>⌫</button>
        </div>
      </div>
    </div>
  )
}
