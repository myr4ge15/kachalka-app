import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getAllExercisesForAdmin } from '../db/repo.js'
import { useSyncStatus } from '../db/sync.js'
import { AdminError } from '../lib/admin.js'
import InvitesSection from '../components/InvitesSection.jsx'
import BackButton from '../components/BackButton.jsx'
import AdminDisciplines from '../components/AdminDisciplines.jsx'
import AdminFeedback from '../components/AdminFeedback.jsx'
import { AdminMfaGate, AdminMfaPanel } from '../components/AdminMfa.jsx'
import { mfaState, needsCode } from '../lib/adminMfa.js'
import AccessSection from '../components/admin/AccessSection.jsx'
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
  const [open, setOpen] = useState(null) // null | 'disciplines' | 'exercises' | 'users' | 'invites' | 'feedback' | 'access' | 'mfa'
  const toggle = (key) => setOpen((cur) => (cur === key ? null : key))

  const errMsg = (e) => (e instanceof AdminError ? e.message : String(e?.message ?? e))

  // 2FA (v6.14.0): включена, а сессия не подтверждена кодом — сначала код. Решает
  // сервер (is_admin() откажет и так); здесь — не показывать Админку, которая не
  // сработает. Пока проверяем или не узнали (нет сети) — разделы как есть.
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

  return (
    <div className="screen admin">
      <div className="admin-head">
        <BackButton onClick={onBack} label="Назад в профиль" />
        <h2 className="admin-title">Админка</h2>
      </div>

      {locked && <AdminMfaGate factorId={mfa.factorId} online={online} onPassed={loadMfa} />}
      {!locked && (<>

      {!online && (
        <p className="admin-offline" role="status">
          Нет сети. Админ-операции доступны только онлайн.
        </p>
      )}

      <div className="admin-nav">
        <button className={'admin-nav-btn' + (open === 'disciplines' ? ' open' : '')}
          onClick={() => toggle('disciplines')} aria-expanded={open === 'disciplines'}>
          <span className="admin-nav-name">Дисциплины рейтинга</span>
          <span className="admin-nav-chev" aria-hidden="true" />
        </button>
        {open === 'disciplines' && <div className="admin-panel"><AdminDisciplines userId={user.id} exercises={exercises ?? []} online={online} /></div>}
        <button
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
              online={online}
              errMsg={errMsg}
            />
          </div>
        )}

        <button
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
            />
          </div>
        )}

        <button
          className={'admin-nav-btn' + (open === 'invites' ? ' open' : '')}
          onClick={() => toggle('invites')}
          aria-expanded={open === 'invites'}
        >
          <span className="admin-nav-name">Приглашения</span>
          <span className="admin-nav-chev" aria-hidden="true" />
        </button>
        {open === 'invites' && (
          <div className="admin-panel">
            <InvitesSection online={online} errMsg={errMsg} />
          </div>
        )}

        <button
          className={'admin-nav-btn' + (open === 'feedback' ? ' open' : '')}
          onClick={() => toggle('feedback')}
          aria-expanded={open === 'feedback'}
        >
          <span className="admin-nav-name">Обращения</span>
          <span className="admin-nav-chev" aria-hidden="true" />
        </button>
        {open === 'feedback' && (
          <div className="admin-panel">
            <AdminFeedback online={online} />
          </div>
        )}

        <button
          className={'admin-nav-btn' + (open === 'access' ? ' open' : '')}
          onClick={() => toggle('access')}
          aria-expanded={open === 'access'}
        >
          <span className="admin-nav-name">Доступ к тренировкам</span>
          <span className="admin-nav-chev" aria-hidden="true" />
        </button>
        {open === 'access' && (
          <div className="admin-panel">
            <AccessSection meId={user.id} online={online} errMsg={errMsg} />
          </div>
        )}

        <button
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
      </div>
      </>)}
    </div>
  )
}
