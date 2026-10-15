import { useCallback, useEffect, useState } from 'react'
import { clearPushLog, readPushLog } from '../../lib/pushIntent.js'

// Журнал нажатий на пуш (v8.9.4) — отладка перехода по пушу на iPhone, только админу.
// Шаги пишут service worker (public/push-sw.js) и приложение (lib/pushIntent.js, useAppNav)
// в общий кэш устройства. Свежие — сверху.
const time = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export default function PushLog() {
  const [list, setList] = useState(null)
  const load = useCallback(() => { readPushLog().then((l) => setList([...l].reverse())) }, [])
  useEffect(() => { load() }, [load])

  return (
    <section className="sec push-log">
      <p className="sec-title">Журнал нажатий (отладка)</p>
      <p className="push-note">Нажми на пуш, вернись сюда и нажми «Обновить». Видно только админу.</p>
      <div className="fc-actions">
        <button type="button" className="btn ghost" onClick={load}>Обновить</button>
        <button type="button" className="btn ghost" onClick={() => clearPushLog().then(load)}>Очистить</button>
      </div>
      {list && list.length === 0 && <p className="push-note">Пусто.</p>}
      {list && list.length > 0 && (
        <ol className="push-log-list">
          {list.map((r, i) => (
            <li key={i}>
              <span className="push-log-t">{time(r.at)}</span> <b>{r.who}</b> {r.ev}
              {r.detail ? <span className="push-log-d"> · {r.detail}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
