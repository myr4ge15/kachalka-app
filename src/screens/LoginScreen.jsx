import { useState, useEffect } from 'react'
import { supabase } from '../db/supabase.js'
import { getUsers, cacheUsers } from '../db/repo.js'
import { login as authLogin, verifyPinOffline, LoginError } from '../lib/auth.js'

export default function LoginScreen({ onLogin }) {
  const [users, setUsers] = useState([])
  const [selected, setSelected] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // Имена для пикера: сначала из кэша (IndexedDB) — мгновенно и офлайн, затем
  // тихо обновляем из login_users (view БЕЗ хэшей/соли/роли, доступен анониму).
  // PIN здесь больше не тянем: сверка идёт в auth-login (онлайн) либо по
  // локальному кэшу своего хэша (офлайн, verifyPinOffline).
  useEffect(() => {
    let alive = true
    async function load() {
      const cached = await getUsers()
      if (alive && cached.length) {
        setUsers(cached)
        setLoading(false)
      }
      try {
        const { data, error } = await supabase
          .from('login_users')
          .select('id, name')
          .order('name')
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
    if (pin.length !== 4 || !selected || busy) return
    setBusy(true)
    try {
      // 1) Офлайн-разблокировка по локальному кэшу своего хэша (мгновенно).
      const offline = await verifyPinOffline(selected.id, pin)
      if (offline === false) {
        setError('Неверный PIN')
        setPin('')
        return
      }
      if (offline) {
        // UI открываем сразу; если есть сеть — молча перевыпускаем сессию.
        if (navigator.onLine) authLogin(selected.id, pin).catch(() => {})
        onLogin(offline)
        return
      }

      // 2) Кэша нет (первый вход на устройстве) — нужен онлайн-вход.
      if (!navigator.onLine) {
        setError('Нет сети, а на этом устройстве ещё не входили. Подключись к сети для первого входа.')
        setPin('')
        return
      }
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
        <div className="card">
          <h1 className="title">Журнал тренировок</h1>
          <p className="muted">Выбери себя</p>
          <div className="user-list">
            {users.map((u) => (
              <button key={u.id} className="user-btn" onClick={() => pickUser(u)}>
                {u.name}
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
      <div className="card">
        <button className="link-btn back" onClick={() => setSelected(null)}>← назад</button>
        <h2 className="title">{selected.name}</h2>
        <p className="muted">Введи PIN (4 цифры)</p>

        <div className="pin-dots">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={i < pin.length ? 'dot filled' : 'dot'} />
          ))}
        </div>
        {error && <p className="error">{error}</p>}

        <div className="keypad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button key={n} className="key" onClick={() => pressDigit(String(n))}>{n}</button>
          ))}
          <span />
          <button className="key" onClick={() => pressDigit('0')}>0</button>
          <button className="key key-del" onClick={backspace}>⌫</button>
        </div>
      </div>
    </div>
  )
}
