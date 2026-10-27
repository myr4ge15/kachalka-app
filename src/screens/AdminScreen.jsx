import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getAllExercisesForAdmin } from '../db/repo.js'
import { useSyncStatus } from '../db/sync.js'
import { AdminError, adminListUsers, adminListInvites } from '../lib/admin.js'
import { adminListFeedback } from '../lib/feedbackApi.js'
import { createAdminCache } from '../lib/adminCache.js'
import InvitesSection from '../components/social/InvitesSection.jsx'
import BackButton from '../components/ui/BackButton.jsx'
import Chevron from '../components/ui/Chevron.jsx'
import NavLayers from '../components/ui/NavLayers.jsx'
import AdminDisciplines from '../components/admin/AdminDisciplines.jsx'
import AdminFeedback from '../components/admin/AdminFeedback.jsx'
import { AdminMfaGate, AdminMfaPanel } from '../components/admin/AdminMfa.jsx'
import PushLog from '../components/notifications/PushLog.jsx'
import SwipeLog from '../components/admin/SwipeLog.jsx'
import { mfaState, needsCode } from '../lib/adminMfa.js'
import ExercisesSection from '../components/admin/ExercisesSection.jsx'
import UsersSection from '../components/admin/UsersSection.jsx'
import ViewAllSection from '../components/admin/ViewAllSection.jsx'
import { useViewAll } from '../hooks/useViewAll.js'
import { viewAllActive } from '../lib/viewAll.js'

// Экран «Админка» (PLAN-admin). Виден только при role='admin' (вход из Профиля);
// сервер все равно перепроверяет роль в каждой операции. Все мутации требуют
// сети — офлайн действия задизейблены с пояснением.
//
// Пропсы: user, onBack(), contentRef/edgeSwipeOn (свайп «назад» из раздела), onInnerNav(bool) — открыт
// раздел: свайп ведет он, а не весь экран (App). Секции — components/admin/*, 2FA — components/AdminMfa.jsx.
// Разделы — отдельными экранами поверх меню (components/ui/NavLayers.jsx, 23.10.2026; до того аккордеон).
const SECTIONS = [
  { key: 'disciplines', title: 'Дисциплины рейтинга' },
  { key: 'exercises', title: 'Справочник упражнений' },
  { key: 'users', title: 'Пользователи' },
  { key: 'invites', title: 'Приглашения' },
  { key: 'feedback', title: 'Обращения' },
  // «Доступ к тренировкам» (связи вручную) убран в v9.0.0: связи — это дружбы («Друзья»).
  { key: 'mfa', title: 'Защита (2FA)' },
  // Временный просмотр всех участников (27.10.2026, PLAN-admin-view-all.md).
  { key: 'viewall', title: 'Режим наблюдателя' },
  // Журнал пушей этого устройства (v8.9.6) — отладка перехода по пушу.
  { key: 'pushlog', title: 'Журнал пушей (это устройство)' },
  // Журнал свайпов «назад» (23.10.2026) — отладка «свайп прыгает»: что видел жест на этом телефоне.
  { key: 'swipelog', title: 'Журнал свайпов (это устройство)' },
]

export default function AdminScreen({ user, onBack, contentRef, edgeSwipeOn = false, onInnerNav }) {
  const { online } = useSyncStatus()
  const exercises = useLiveQuery(() => getAllExercisesForAdmin(), [], [])
  const viewAllOn = viewAllActive(useViewAll())

  const [section, setSection] = useState(null) // открытый раздел — ключ из SECTIONS
  const [deep, setDeep] = useState(false) // в справочнике открыто упражнение — свайп ведет оно
  const innerRef = useRef(onInnerNav)
  innerRef.current = onInnerNav
  useEffect(() => { innerRef.current?.(section !== null) }, [section])
  useEffect(() => () => innerRef.current?.(false), [])

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

  const offlineNote = !online && (
    <p className="admin-offline" role="status">
      Нет сети. Админ-операции доступны только онлайн.
    </p>
  )

  // Раздел — свой экран поверх меню (23.10.2026, замечание владельца: аккордеон «на полстраницы»).
  const current = SECTIONS.find((x) => x.key === section) ?? null
  const close = () => setSection(null)
  const head = current && (
    <div className="admin-head">
      <BackButton onClick={close} label="Назад в Админку" />
      <h2 className="admin-title">{current.title}</h2>
    </div>
  )
  const plain = (body) => <div className="screen admin">{head}{offlineNote}{body}</div>
  let sectionView = null
  if (section === 'disciplines') sectionView = plain(<AdminDisciplines userId={user.id} exercises={exercises ?? []} online={online} />)
  if (section === 'exercises') {
    sectionView = (
      <ExercisesSection exercises={exercises ?? []} userId={user.id} online={online} errMsg={errMsg}
        head={<>{head}{offlineNote}</>} contentRef={contentRef} edgeSwipeOn={edgeSwipeOn} onDeepChange={setDeep} />
    )
  }
  if (section === 'users') sectionView = plain(<UsersSection meId={user.id} online={online} errMsg={errMsg} cache={cache} />)
  if (section === 'invites') sectionView = plain(<InvitesSection online={online} errMsg={errMsg} cache={cache} />)
  if (section === 'feedback') sectionView = plain(<AdminFeedback online={online} cache={cache} />)
  if (section === 'mfa') {
    sectionView = plain(mfa
      ? <AdminMfaPanel state={mfa} online={online} onChange={loadMfa} />
      : <p className="admin-hint">Не удалось узнать состояние 2FA — проверь сеть и открой раздел заново.</p>)
  }
  if (section === 'viewall') sectionView = plain(<ViewAllSection userId={user.id} online={online} />)
  if (section === 'pushlog') sectionView = plain(<PushLog />)
  if (section === 'swipelog') sectionView = plain(<SwipeLog />)

  const hub = (
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

      {offlineNote}

      <div className="admin-nav">
        {SECTIONS.map(({ key, title }) => (
          <button key={key} type="button" className="admin-nav-btn" onClick={() => setSection(key)}>
            <span className="admin-nav-name">{(key === 'mfa' && mfa?.enabled) || (key === 'viewall' && viewAllOn) ? `${title} · вкл` : title}</span>
            <Chevron className="admin-nav-chev" />
          </button>
        ))}
      </div>
      </>)}
    </div>
  )

  return (
    <NavLayers open={Boolean(sectionView)} onBack={close} under={hub} contentRef={contentRef}
      swipe={edgeSwipeOn && !deep}>
      {sectionView}
    </NavLayers>
  )
}
