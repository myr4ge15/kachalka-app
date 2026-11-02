import { useRef, useState } from 'react'
import { checkDomainMigration } from '../../db/domainMigration.js'
import SheetDialog from '../ui/SheetDialog.jsx'

const TARGET = 'https://kachalka-app.ru/app/'
const messages = {
  offline: 'Нужен интернет, чтобы проверить сохранение данных.',
  draft: 'Есть незавершенная тренировка или несохраненные правки. Сохрани их в старом приложении и повтори проверку.',
  sync: 'Синхронизация не завершилась. Подожди немного и повтори проверку. Если ошибка остается, проверь вход и синхронизацию в профиле.',
  account: 'Учетка изменилась. Закрой это окно и начни проверку заново.',
  pending: 'На устройстве остались неотправленные изменения. Проверь синхронизацию в профиле и повтори попытку.',
  error: 'Не удалось проверить данные. Останься в старом приложении и повтори попытку позже.',
}

export default function DomainMigration({ userId, phase = import.meta.env.VITE_DOMAIN_MIGRATION }) {
  const [open, setOpen] = useState(phase === 'retire')
  const [status, setStatus] = useState('idle')
  const checking = useRef(false)
  const old = window.location.hostname === 'myr4ge15.github.io' && window.location.pathname.startsWith('/kachalka-app/')
  if (!old || !['announce', 'retire'].includes(phase)) return null

  async function proceed() {
    if (checking.current) return
    checking.current = true
    setStatus('checking')
    try {
      const result = await checkDomainMigration(userId)
      if (result === 'ready') {
        // Проверка и переход одним действием: не оставляем устаревающую ссылку
        // «все сохранено», пока человек продолжает редактировать тренировку.
        window.location.assign(TARGET)
      } else setStatus(result)
    } catch {
      setStatus('error')
    } finally {
      checking.current = false
    }
  }

  return <>
    <aside className="domain-migration" aria-label="Переезд приложения">
      <span>{phase === 'retire' ? 'Приложение переехало' : 'Переезжаем на новый адрес'}</span>
      <button className="btn btn--sm" onClick={() => { setStatus('idle'); setOpen(true) }}>Как перейти</button>
    </aside>
    {open && <SheetDialog title="Переезжаем на новый адрес" onDismiss={() => setOpen(false)} dismissDisabled={status === 'checking'}>
      <div className="sheet-scroll">
      <p>Новый адрес: <strong>kachalka-app.ru/app/</strong></p>
      <p>Перед переходом проверим, что данные этой учетки отправлены на сервер. Незавершенные тренировки нужно сначала сохранить.</p>
      <p>На новом адресе войди с прежними логином и PIN. После проверки своих тренировок установи приложение на экран телефона и заново включи уведомления.</p>
      <p>На iPhone открой новый адрес в Safari → «Поделиться» → «На экран Домой». На Android — в меню браузера выбери установку приложения.</p>
      <p>Если на этом устройстве есть другие учетки, выполни переход для каждой. Старую иконку и данные браузера удаляй только после проверки всех учеток.</p>
      </div>
      {messages[status] && <p role="alert">{messages[status]}</p>}
      <div className="btn-row">
        <button className="btn primary" disabled={status === 'checking'} onClick={proceed}>
          {status === 'checking' ? 'Проверяем сохранение…' : 'Проверить данные и перейти'}
        </button>
        <button className="btn" disabled={status === 'checking'} onClick={() => setOpen(false)}>Позже</button>
      </div>
    </SheetDialog>}
  </>
}
