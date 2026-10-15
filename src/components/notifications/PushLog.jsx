import { useCallback, useEffect, useState } from 'react'
import { clearPushLog, diagnoseServiceWorkers, readPushLog } from '../../lib/pushIntent.js'

// Журнал нажатий на пуш (v8.9.4) — отладка перехода по пушу на iPhone; с v8.9.6 — раздел Админки.
// Шаги пишут service worker (public/push-sw.js) и приложение (lib/pushIntent.js, useAppNav)
// в общий кэш устройства. Свежие — сверху. v8.9.6: «Проверить service worker» — регистрации
// устройства и ответ каждой на пинг (версия обработчика пушей; старый код не отвечает).
const time = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export default function PushLog() {
  const [list, setList] = useState(null)
  const [regs, setRegs] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => { readPushLog().then((l) => setList([...l].reverse())) }, [])
  useEffect(() => { load() }, [load])

  async function check() {
    setBusy(true)
    try {
      setRegs(await diagnoseServiceWorkers())
    } catch (e) {
      setRegs([{ scope: 'ошибка', script: String(e?.message ?? e) }])
    } finally {
      setBusy(false)
      load()
    }
  }

  return (
    <section className="sec push-log">
      <p className="push-note">Шаги service worker и приложения при приходе пуша и нажатии на него — на этом устройстве. Нажми на пуш, вернись сюда и нажми «Обновить».</p>
      <div className="fc-actions">
        <button type="button" className="btn ghost" onClick={load}>Обновить</button>
        <button type="button" className="btn ghost" onClick={() => clearPushLog().then(load)}>Очистить</button>
      </div>
      <button type="button" className="btn ghost push-log-check" disabled={busy} onClick={check}>
        {busy ? 'Проверяю…' : 'Проверить service worker'}
      </button>
      {regs && (
        <ul className="push-log-list" aria-label="Регистрации service worker">
          {regs.length === 0 && <li>Регистраций нет</li>}
          {regs.map((r, i) => (
            <li key={i}>
              <b>{r.scope}</b> · {r.state}{r.waiting ? ' (ждет установки)' : ''}{r.controls ? ' · управляет страницей' : ''}
              <span className="push-log-d"> · {r.script}</span>
              <br />пуши: {r.sub ?? 'нет подписки'} · ответ на пинг: {r.ver ?? 'нет (старый код или спит)'}
            </li>
          ))}
        </ul>
      )}
      {list && list.length === 0 && <p className="push-note">Пусто.</p>}
      {list && list.length > 0 && (
        <ol className="push-log-list" aria-label="События пушей">
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
