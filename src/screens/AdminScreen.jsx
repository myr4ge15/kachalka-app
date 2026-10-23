import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getAllExercisesForAdmin } from '../db/repo.js'
import { useSyncStatus } from '../db/sync.js'
import { AdminError, adminListUsers, adminListInvites } from '../lib/admin.js'
import { adminListFeedback } from '../lib/feedbackApi.js'
import { createAdminCache } from '../lib/adminCache.js'
import InvitesSection from '../components/social/InvitesSection.jsx'
import BackButton from '../components/ui/BackButton.jsx'
import { useRevealFocus } from '../hooks/useRevealFocus.js'
import AdminDisciplines from '../components/admin/AdminDisciplines.jsx'
import AdminFeedback from '../components/admin/AdminFeedback.jsx'
import { AdminMfaGate, AdminMfaPanel } from '../components/admin/AdminMfa.jsx'
import PushLog from '../components/notifications/PushLog.jsx'
import { mfaState, needsCode } from '../lib/adminMfa.js'
import ExercisesSection from '../components/admin/ExercisesSection.jsx'
import UsersSection from '../components/admin/UsersSection.jsx'

// Экран «Админка» (PLAN-admin). Виден только при role='admin' (вход из Профиля);
// сервер все равно перепроверяет роль в каждой операции. Все мутации требуют
// сети — офлайн действия задизейблены с пояснением.
//
// Пропсы: user, onBack(). Секции — components/admin/*, 2FA — components/AdminMfa.jsx.
export default function AdminScreen({ user, onBack }) {
  const { online } = useSyncStatus()
  const exercises = useLiveQuery(() => getAllExercisesForAdmin(), [], [])

  // Разделы свернуты по умолчанию; раскрывается тот, что админ сам открыл (аккордеон).
  const [open, setOpen] = useState(null) // null | 'disciplines' | 'exercises' | 'users' | 'invites' | 'feedback' | 'mfa' | 'pushlog'
  const toggle = (key) => setOpen((cur) => (cur === key ? null : key))
  // Раскрытый раздел — к верху экрана (v8.0.1): содержимое длинное и грузится не сразу,
  // и при центрировании/без прокрутки оно уходило под нижнее меню. Закрытие экран не двигает.
  const navRevealRef = useRevealFocus(open, { block: 'start' })

  const errMsg = (e) => (e instanceof AdminError ? e.message : String(e?.message ?? e))

  // 2FA (v6.14.0): включена, а сессия не подтверждена кодом — сначала код. Решает
  // сервер (is_admin() откажет и так); здесь — не показывать Админку, которая не
  // сработает. v8.9.2: разделы — ТОЛЬКО после ответа «2FA не нужна / пройдена»; пока
  // проверяем или не узнали (нет сети) — меню не рисуем (мелькало до экрана кода).
  const [mfa, setMfa] = useState(undefined) // undefined — проверяем; null — не узнали
  const loadMfa = async () => {
    try { setMfa(await mfaState()) } catch { setMfa(null) }
  }
  useEffect(() => {
    let alive = true
    mfaState().then((s) => alive && setMfa(s), () => alive && setMfa(null))
    return () => { alive = false }
  }, [])
  const locked = needsCode(mfa)
  const cleared = mfa != null && !locked

  // Списки разделов — заранее и параллельно (v8.0.1): раньше каждый раздел ходил в сеть
  // при каждом раскрытии (0,3–0,6 с пустоты). Кэш живет, пока открыт экран. Ждем 2FA:
  // до подтверждения кода сервер все равно откажет. Ошибки тут молчат — раздел
  // при раскрытии повторит запрос и покажет ошибку сам.
  const cache = useMemo(() => createAdminCache(), [])
  useEffect(() => {
    if (!online || !cleared) return
    const quiet = () => {}
    cache.load('users', adminListUsers).catch(quiet)
    cache.load('invites', adminListInvites).catch(quiet)
    cache.load('feedback', () => adminListFeedback(false)).catch(quiet)
  }, [cache, online, cleared])

  return (
    <div className="screen admin">
      <div className="admin-head">
        <BackButton onClick={onBack} label="Назад в профиль" />
        <h2 className="admin-title">Админка</h2>
      </div>

      {mfa === undefined && <p className="muted admin-offline" role="status">Проверяю защиту…</p>}
      {mfa === null && (
        <div className="admin-offline" role="alert">
          <p>Не получилось проверить защиту (2FA). Админка откроется, когда появится связь.</p>
          <button type="button" className="btn ghost" onClick={() => { setMfa(undefined); loadMfa() }}>Повторить</button>
        </div>
      )}
      {locked && <AdminMfaGate factorId={mfa.factorId} online={online} onPassed={loadMfa} />}
      {cleared && (<>

      {!online && (
        <p className="admin-offline" role="status">
          Нет сети. Админ-операции доступны только онлайн.
        </p>
      )}

      <div className="admin-nav">
        <button ref={open === 'disciplines' ? navRevealRef : null} className={'admin-nav-btn' + (open === 'disciplines' ? ' open' : '')}
          onClick={() => toggle('disciplines')} aria-expanded={open === 'disciplines'}>
          <span className="admin-nav-name">Дисциплины рейтинга</span>
          <span className="admin-nav-chev" aria-hidden="true" />
        </button>
        {open === 'disciplines' && <div className="admin-panel"><AdminDisciplines userId={user.id} exercises={exercises ?? []} online={online} /></div>}
        <button
          ref={open === 'exercises' ? navRevealRef : null}
          className={'admin-nav-btn' + (open === 'exercises' ? ' open' : '')}
          onClick={() => toggle('exercises')}
          aria-expanded={open === 'exercises'}
        >
          <span className="admin-nav-name">Справочник упражнений</span>
          <span className="admin-nav-chev" aria-hidden="true" />
        </button>
        {open === 'exercises' && (
          <div className="admin-panel">
            <ExercisesSection
              exercises={exercises ?? []}
              userId={user.id}
              online={online}
              errMsg={errMsg}
            />
          </div>
        )}

        <button
          ref={open === 'users' ? navRevealRef : null}
          className={'admin-nav-btn' + (open === 'users' ? ' open' : '')}
          onClick={() => toggle('users')}
          aria-expanded={open === 'users'}
        >
          <span className="admin-nav-name">Пользователи</span>
          <span className="admin-nav-chev" aria-hidden="true" />
        </button>
        {open === 'users' && (
          <div className="admin-panel">
            <UsersSection
              meId={user.id}
              online={online}
              errMsg={errMsg}
              cache={cache}
            />
          </div>
        )}

        <button
          ref={open === 'invites' ? navRevealRef : null}
          className={'admin-nav-btn' + (open === 'invites' ? ' open' : '')}
          onClick={() => toggle('invites')}
          aria-expanded={open === 'invites'}
        >
          <span className="admin-nav-name">Приглашения</span>
          <span className="admin-nav-chev" aria-hidden="true" />
        </button>
        {open === 'invites' && (
          <div className="admin-panel">
            <InvitesSection online={online} errMsg={errMsg} cache={cache} />
          </div>
        )}

        <button
          ref={open === 'feedback' ? navRevealRef : null}
          className={'admin-nav-btn' + (open === 'feedback' ? ' open' : '')}
          onClick={() => toggle('feedback')}
          aria-expanded={open === 'feedback'}
        >
          <span className="admin-nav-name">Обращения</span>
          <span className="admin-nav-chev" aria-hidden="true" />
        </button>
        {open === 'feedback' && (
          <div className="admin-panel">
            <AdminFeedback online={online} cache={cache} />
          </div>
        )}

        {/* «Доступ к тренировкам» (связи вручную) убран в v9.0.0: связи — это дружбы, их
            заводят сами участники («Друзья»). Серверные admin_*_connection снимет этап 3. */}
        <button
          ref={open === 'mfa' ? navRevealRef : null}
          className={'admin-nav-btn' + (open === 'mfa' ? ' open' : '')}
          onClick={() => toggle('mfa')}
          aria-expanded={open === 'mfa'}
        >
          <span className="admin-nav-name">Защита (2FA){mfa?.enabled ? ' · вкл' : ''}</span>
          <span className="admin-nav-chev" aria-hidden="true" />
        </button>
        {open === 'mfa' && (
          <div className="admin-panel">
            {mfa
              ? <AdminMfaPanel state={mfa} online={online} onChange={loadMfa} />
              : <p className="admin-hint">Не удалось узнать состояние 2FA — проверь сеть и открой раздел заново.</p>}
          </div>
        )}
        {/* Журнал пушей этого устройства (v8.9.6; был в «Пуш-уведомлениях») — отладка перехода по пушу. */}
        <button
          ref={open === 'pushlog' ? navRevealRef : null}
          className={'admin-nav-btn' + (open === 'pushlog' ? ' open' : '')}
          onClick={() => toggle('pushlog')}
          aria-expanded={open === 'pushlog'}
        >
          <span className="admin-nav-name">Журнал пушей (это устройство)</span>
          <span className="admin-nav-chev" aria-hidden="true" />
        </button>
        {open === 'pushlog' && <div className="admin-panel"><PushLog /></div>}
      </div>
      </>)}
    </div>
  )
}
