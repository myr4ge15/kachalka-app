import { useState, useEffect } from 'react'
import { supabase } from '../db/supabase.js'
import { getUsers, cacheUsers } from '../db/repo.js'
import { sha256Hex } from '../lib/hash.js'

export default function LoginScreen({ onLogin }) {
  const [users, setUsers] = useState([])
  const [selected, setSelected] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  // Офлайн-вход: сначала показываем пользователей из кэша (IndexedDB),
  // затем тихо обновляем их из сети и перекэшируем. PIN сверяется по хэшу
  // локально, поэтому вход работает и без сети — если кэш уже наполнен.
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
          .from('users')
          .select('id, name, pin_hash, role')
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
    if (pin.length >= 4) return
    setError('')
    setPin(pin + d)
  }

  function backspace() {
    setPin(pin.slice(0, -1))
  }

  async function submit() {
    if (pin.length !== 4 || !selected) return
    const hash = await sha256Hex(pin)
    if (hash === selected.pin_hash) {
      onLogin({ id: selected.id, name: selected.name, role: selected.role })
    } else {
      setError('Неверный PIN')
      setPin('')
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
