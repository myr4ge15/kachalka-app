import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { isConfigured, warmup, supabase } from './db/supabase.js'
import { logout as authLogout, getCachedProfile } from './lib/auth.js'
import { startSync, useSyncStatus } from './db/sync.js'
import { countUnread } from './db/notifications.js'
import { getCachedUser } from './db/repo.js'
import { openUserDb, closeUserDb } from './db/local.js'
import { syncBadgeState } from './lib/syncStatus.js'
import { readStoredUserId, hydrateProfile } from './lib/sessionProfile.js'
import { emitReselect } from './lib/appEvents.js'
import LoginScreen from './screens/LoginScreen.jsx'
import Toast from './components/Toast.jsx'
import Avatar from './components/Avatar.jsx'
import ScreenSkeleton from './components/ScreenSkeleton.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Экраны-вкладки грузим лениво: код активной вкладки подтягивается по требованию.
// Главный выигрыш — «Прогресс» тянет тяжёлый recharts, который теперь не попадает
// в стартовый бандл, а грузится отдельным чанком при открытии вкладки.
// Функции импорта держим отдельно, чтобы ПРЕФЕТЧИТЬ их в простое после входа
// (см. эффект ниже): без префетча первое переключение на каждую вкладку упиралось
// в загрузку чанка → мелькал Suspense-скелетон, хотя данные уже локальны. С
// префетчем чанки уже в кэше → переход мгновенный, без заглушки.
const load = {
  home: () => import('./screens/HomeScreen.jsx'),
  history: () => import('./screens/HistoryScreen.jsx'),
  progress: () => import('./screens/ProgressScreen.jsx'),
  feed: () => import('./screens/FeedScreen.jsx'),
  notif: () => import('./screens/NotificationsScreen.jsx'),
  profile: () => import('./screens/ProfileScreen.jsx'),
  admin: () => import('./screens/AdminScreen.jsx'),
  freshness: () => import('./screens/FreshnessScreen.jsx'),
  myex: () => import('./screens/MyExercisesScreen.jsx'),
  achievements: () => import('./screens/AchievementsScreen.jsx'),
}
const HomeScreen = lazy(load.home)
const HistoryScreen = lazy(load.history)
const ProgressScreen = lazy(load.progress)
const FeedScreen = lazy(load.feed)
const NotificationsScreen = lazy(load.notif)
const ProfileScreen = lazy(load.profile)
const AdminScreen = lazy(load.admin)
const FreshnessScreen = lazy(load.freshness)
const MyExercisesScreen = lazy(load.myex)
const AchievementsScreen = lazy(load.achievements)

// Иконка состояния синхронизации — инлайн-SVG (без зависимостей), как TabIcon.
// Красится через currentColor (цвет задаёт класс .sync-badge.<cls>), спиннер
// крутит CSS (.sync-ico.spin).
function SyncIcon({ name }) {
  const p = {
    className: name === 'syncing' ? 'sync-ico spin' : 'sync-ico',
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
  }
  if (name === 'ok') return <svg {...p}><path d="M4 12.5l5 5L20 6" /></svg>
  if (name === 'syncing') return <svg {...p}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 4v5h-5" /></svg>
  if (name === 'pending') return <svg {...p}><path d="M12 19V6" /><path d="M6 11l6-6 6 6" /></svg>
  if (name === 'offline') return (
    <svg {...p}>
      <path d="M6.657 18c-2.572 0-4.657-2.007-4.657-4.483 0-2.475 2.085-4.482 4.657-4.482.393-1.762 1.794-3.2 3.675-3.773 1.88-.572 3.956-.193 5.444 1 1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.483 0 1.921-1.551 3.481-3.464 3.481h-11.878" />
      <path d="M3 3l18 18" />
    </svg>
  )
  // warn
  return <svg {...p}><path d="M12 4l9 16H3z" /><path d="M12 10v4" /><path d="M12 17h.01" /></svg>
}

// Индикатор состояния синхронизации в шапке.
function SyncBadge() {
  const { online, syncing, pending, dead, netError } = useSyncStatus()
  // Класс/иконка/текст — чистой логикой (см. lib/syncStatus.js). Иконка есть всегда,
  // текст — только когда есть что чинить (очередь/офлайн/застряло). Застрявшие
  // изменения (dead) делают бейдж предупреждающим, а не «синхронизировано», пока
  // карточки висят с жёлтым кружком. netError — последний прогон синка упал по сети
  // (напр. таймаут в авиарежиме при online=true): тоже предупреждение, а не галочка.
  const { cls, icon, text, title } = syncBadgeState({ online, syncing, pending, dead, netError })
  return (
    <span className={`sync-badge ${cls}`} role="status" aria-label={title} title={title}>
      <SyncIcon name={icon} />
      {text && <span className="sync-badge-txt">{text}</span>}
    </span>
  )
}

// Статус синхронизации + колокольчик уведомлений — единый блок. Живёт и в шапке
// (мобайл), и в сайдбаре (десктоп); раньше разметка колокольчика дублировалась.
function SyncTools({ unread, onOpenNotif }) {
  return (
    <>
      <SyncBadge />
      <button
        className={'bell' + (unread > 0 ? ' has' : '')}
        onClick={onOpenNotif}
        aria-label={unread > 0 ? `Уведомления: ${unread} новых` : 'Уведомления'}
      >
        <svg
          className="bell-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="bell-count">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>
    </>
  )
}

// Иконки нижней панели — инлайн-SVG (без зависимостей), красятся через currentColor,
// плавную смену цвета и лёгкое увеличение активной задаёт CSS (.tab / .tab-ico).
function TabIcon({ name }) {
  const p = {
    className: 'tab-ico', viewBox: '0 0 24 24', width: 24, height: 24,
    fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
  }
  if (name === 'home') return (
    <svg {...p}>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
      <path d="M9 20v-6h6v6" />
    </svg>
  )
  if (name === 'history') return (
    <svg {...p}>
      <rect x="2" y="8" width="4" height="8" rx="1.5" />
      <rect x="18" y="8" width="4" height="8" rx="1.5" />
      <path d="M6 12h12" />
    </svg>
  )
  if (name === 'feed') return (
    <svg {...p}>
      <path d="M16 6h3a1 1 0 0 1 1 1v11a2 2 0 0 1-4 0v-13a1 1 0 0 0-1-1h-10a1 1 0 0 0-1 1v12a3 3 0 0 0 3 3h11" />
      <path d="M8 8h4M8 12h4M8 16h4" />
    </svg>
  )
  return (
    <svg {...p}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  )
}

// Компактный фолбэк пер-экранного ErrorBoundary: рухнул рендер одной вкладки.
// Живёт внутри <main>, поэтому шапка и таббар остаются — можно уйти на другую
// вкладку (это сбросит ошибку через remount по key={tab}) или повторить рендер.
function ScreenCrash({ onRetry }) {
  return (
    <div className="screen center">
      <div className="card warn">
        <h2>Экран не открылся</h2>
        <p>
          Что-то пошло не так на этой вкладке. Данные тренировок сохранены
          локально — открой другую вкладку или попробуй снова.
        </p>
        <button className="btn primary" onClick={onRetry}>
          Попробовать снова
        </button>
      </div>
    </div>
  )
}

// В localStorage держим ТОЛЬКО id вошедшего (не имя/роль): на общих телефонах
// профиль лежал открыто и читался через devtools. Имя/роль восстанавливаем из
// loginDb (ростер + офлайн-кэш PIN, см. handleLogin/restore). id переживает
// перезапуск, как и сессия Supabase Auth (persistSession); PIN спрашивается
// заново лишь когда refresh-токен умрёт (~7 дней) или после logout.
const SESSION_KEY = 'gym_app_user'
const TAB_KEY = 'gym_app_tab'

export default function App() {
  const [user, setUser] = useState(null)
  // Активная вкладка переживает F5 (sessionStorage). Дефолт — 'home' (Главная,
  // «5 секунд после открытия»). Старое значение 'workout' (вкладки больше нет)
  // проваливается в дефолт.
  const [tab, setTab] = useState(() => {
    const saved = sessionStorage.getItem(TAB_KEY)
    return saved && saved !== 'workout' ? saved : 'home'
  }) // 'home' | 'history' | 'feed' | 'progress' | 'notif' | 'profile' | 'admin' | 'freshness' | 'myex' | 'achievements'

  // Упражнение, с которым открыть «Прогресс» (проброс из ЛК по тапу на рекорд).
  const [progressExId, setProgressExId] = useState(null)

  // Счётчик непрочитанных рекордов-уведомлений (для бейджа на колокольчике).
  // Живо пересчитывается при изменении своих тренировок, ленты и метки просмотра.
  const unread = useLiveQuery(
    () => (user?.id ? countUnread(user.id) : 0),
    [user?.id],
    0
  )

  // Свой аватар для шапки — из кэша пользователей (пополняется pull'ом login_users
  // и мгновенно после загрузки своего аватара в ЛК). Нет картинки → инициал.
  const myCached = useLiveQuery(
    () => (user?.id ? getCachedUser(user.id) : null),
    [user?.id]
  )

  // Имя сменили извне (админка/другое устройство) — pull обновил кэш login_users
  // (getCachedUser), но локальная сессия (localStorage) держит старое имя, из-за
  // чего профиль и шапка отстают от лидерборда. Сверяем и подтягиваем из кэша.
  useEffect(() => {
    const fresh = myCached?.name
    if (fresh && user?.id && fresh !== user.name) handleRenamed(fresh)
  }, [myCached?.name, user?.id, user?.name])

  // Будим базу заранее, как только приложение открылось
  useEffect(() => { warmup() }, [])

  // Фоновая синхронизация очереди и подтяжка свежих данных, пока есть вход.
  useEffect(() => {
    if (!user?.id) return
    return startSync(() => user.id)
  }, [user?.id])

  // Запоминаем активную вкладку
  useEffect(() => { sessionStorage.setItem(TAB_KEY, tab) }, [tab])

  // Префетч чанков остальных вкладок в простое после входа: активная вкладка уже
  // грузится, а прочие подтягиваем заранее, чтобы их открытие было мгновенным и не
  // мелькал Suspense-скелетон. Повторный import уже загруженного модуля — no-op
  // (браузер отдаёт из кэша). Ошибки глотаем: префетч — оптимизация, не критичен.
  useEffect(() => {
    if (!user?.id) return
    const imports = [load.history, load.feed, load.progress, load.freshness, load.notif, load.profile, load.myex]
    if (user.role === 'admin') imports.push(load.admin)
    const prefetch = () => { for (const imp of imports) imp().catch(() => {}) }
    const ric = window.requestIdleCallback
    if (ric) {
      const id = ric(prefetch, { timeout: 3000 })
      return () => window.cancelIdleCallback?.(id)
    }
    const id = setTimeout(prefetch, 800)
    return () => clearTimeout(id)
  }, [user?.id, user?.role])

  // Скроллится не окно, а внутренняя .content (overflow-y:auto, см. index.css).
  // Тап по кнопке вкладки всегда возвращает её контент в самый верх — в т.ч.
  // повторный тап по уже активной вкладке (как «прокрутка наверх» в iOS).
  const contentRef = useRef(null)
  function goTab(next) {
    // Повторный тап по уже открытой вкладке — контент не меняется: плавно
    // возвращаем его наверх (как «прокрутка к началу» в iOS) + сигнал «обнови меня»
    // (напр. Лента перезапрашивает посты).
    if (next === tab) {
      contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      emitReselect(next)
      return
    }
    // Переход на ДРУГУЮ вкладку: сначала меняем экран, потом мгновенно ставим
    // прокрутку в самый верх — ПОСЛЕ рендера нового контента. Раньше scrollTo со
    // smooth вызывался на старом (длинном) экране до свопа: смена высоты обрывала
    // анимацию и вкладка (напр. Лента из Профиля) открывалась не на самом верху.
    setTab(next)
    requestAnimationFrame(() => contentRef.current?.scrollTo({ top: 0 }))
  }

  // Связка ЛК → «Прогресс»: открыть вкладку с заранее выбранным упражнением.
  function openProgressFor(exerciseId) {
    setProgressExId(exerciseId)
    goTab('progress')
  }

  // Восстановление профиля после перезапуска. В localStorage лежит только id;
  // имя берём из ростера (loginDb.users, свежий после pull), роль — из офлайн-
  // кэша PIN (в ростер роль не отдаётся). Работает офлайн (оба источника
  // локальные). Персональную базу открываем ДО setUser, иначе экраны/синк
  // прочитают ещё закрытый `db`. Старый «толстый» блок {id,name,role} читаем по
  // id и тут же перезаписываем тонким — стираем утёкшие имя/роль.
  useEffect(() => {
    const id = readStoredUserId(localStorage.getItem(SESSION_KEY))
    if (!id) return
    ;(async () => {
      const [roster, cache] = await Promise.all([getCachedUser(id), getCachedProfile(id)])
      await openUserDb(id)
      localStorage.setItem(SESSION_KEY, JSON.stringify({ id }))
      setUser(hydrateProfile(id, roster, cache))
    })().catch(() => {})
  }, [])

  // Если сессия Supabase завершилась (refresh-токен истёк через ~7 дней или
  // logout) — возвращаем на экран входа. Офлайн событие не приходит, поэтому
  // UI остаётся доступным до появления сети (тогда либо тихий перевыпуск, либо
  // SIGNED_OUT → PIN заново).
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        localStorage.removeItem(SESSION_KEY)
        setUser(null)
        closeUserDb()
      }
    })
    return () => data?.subscription?.unsubscribe?.()
  }, [])

  async function handleLogin(u) {
    // Открываем ПЕРСОНАЛЬНУЮ базу пользователя ДО показа экранов (изоляция данных:
    // у каждого своя физическая IndexedDB, чужое в принципе не видно). openUserDb
    // закроет базу предыдущей учётки и перенесёт несинхрон. правки со старой общей
    // базы. Чистка кросс-пользовательских кэшей больше не нужна — изоляция физическая.
    await openUserDb(u.id)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id: u.id }))
    setUser(u)
    setTab('home')
  }

  // Имя сменили в ЛК — обновляем профиль в стейте, чтобы шапка и инициал-аватар
  // сразу показали новое имя. Персистить в localStorage не нужно (там только id):
  // новое имя переживёт перезапуск через ростер/офлайн-кэш PIN (setName их пишет).
  function handleRenamed(name) {
    setUser((u) => (u ? { ...u, name } : u))
  }

  async function handleLogout() {
    await authLogout()
    localStorage.removeItem(SESSION_KEY)
    setUser(null)      // сначала размонтируем экраны и их live-queries…
    closeUserDb()      // …затем закрываем персональную базу
  }

  if (!isConfigured) {
    return (
      <div className="screen center">
        <div className="card warn">
          <h2>Нужна настройка</h2>
          <p>
            Не заданы ключи Supabase. Скопируй <code>.env.example</code> в{' '}
            <code>.env</code>, подставь <code>VITE_SUPABASE_URL</code> и{' '}
            <code>VITE_SUPABASE_KEY</code>, перезапусти <code>npm run dev</code>.
          </p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          className={'topbar-user' + (tab === 'profile' ? ' active' : '')}
          onClick={() => goTab('profile')}
          aria-label="Открыть профиль"
        >
          <Avatar name={user.name} url={myCached?.avatar_url} className="avatar-sm" />
          {user.name} <span className="chev" aria-hidden="true">▾</span>
        </button>
        <SyncTools unread={unread} onOpenNotif={() => goTab('notif')} />
      </header>

      <main className="content" ref={contentRef}>
        <Suspense fallback={<ScreenSkeleton />}>
          {/* key={tab} перезапускает микро-переход (fade+slide-up, .screen-anim)
              на каждую смену вкладки — контент въезжает, а не мигает подменой.
              ErrorBoundary внутри этой обёртки изолирует падение одной вкладки:
              шапка/таббар (вне <main>) живут, а смена вкладки размонтирует
              боундари (новый key) и тем самым сбрасывает ошибку. */}
          <div className="screen-anim" key={tab}>
            <ErrorBoundary fallback={(_err, reset) => <ScreenCrash onRetry={reset} />}>
              {tab === 'home' && (
                <HomeScreen user={user} onNavigate={goTab} />
              )}
              {tab === 'history' && <HistoryScreen user={user} />}
              {tab === 'feed' && <FeedScreen user={user} />}
              {tab === 'progress' && (
                <ProgressScreen
                  user={user}
                  initialExerciseId={progressExId}
                  onConsumed={() => setProgressExId(null)}
                />
              )}
              {tab === 'notif' && <NotificationsScreen user={user} />}
              {tab === 'profile' && (
                <ProfileScreen
                  user={user}
                  onLogout={handleLogout}
                  onOpenProgress={openProgressFor}
                  onOpenFeed={() => goTab('feed')}
                  onRenamed={handleRenamed}
                  onOpenAdmin={() => goTab('admin')}
                  onOpenMyExercises={() => goTab('myex')}
                  onOpenAchievements={() => goTab('achievements')}
                />
              )}
              {tab === 'admin' && user.role === 'admin' && (
                <AdminScreen user={user} onBack={() => goTab('profile')} />
              )}
              {tab === 'freshness' && (
                <FreshnessScreen user={user} onBack={() => goTab('home')} />
              )}
              {tab === 'myex' && (
                <MyExercisesScreen onBack={() => goTab('profile')} />
              )}
              {tab === 'achievements' && (
                <AchievementsScreen user={user} onBack={() => goTab('profile')} />
              )}
            </ErrorBoundary>
          </div>
        </Suspense>
      </main>

      <nav className="tabbar">
        {/* Бренд-шапка сайдбара: видна только на десктопе (≥900px), где .tabbar
            превращается в левую колонку. На мобиле скрыта (display:none). Кликабельна
            — ведёт на Главную. */}
        <button
          className="side-brand"
          onClick={() => goTab('home')}
          aria-label="На главную"
        >
          <span className="side-logo">🏋️</span>
          <span className="side-brand-txt">kachalka-app</span>
        </button>
        <button
          className={tab === 'home' ? 'tab active' : 'tab'}
          onClick={() => goTab('home')}
        >
          <TabIcon name="home" />
          <span>Главная</span>
        </button>
        <button
          className={tab === 'history' ? 'tab active' : 'tab'}
          onClick={() => goTab('history')}
        >
          <TabIcon name="history" />
          <span>Тренировки</span>
        </button>
        <button
          className={tab === 'feed' ? 'tab active' : 'tab'}
          onClick={() => goTab('feed')}
        >
          <TabIcon name="feed" />
          <span>Лента</span>
        </button>
        <button
          className={tab === 'progress' ? 'tab active' : 'tab'}
          onClick={() => goTab('progress')}
        >
          <TabIcon name="progress" />
          <span>Прогресс</span>
        </button>

        {/* Профиль в сайдбаре: виден только на десктопе (≥900px), уезжает вниз
            колонки (.side-foot margin-top:auto). На мобиле скрыт — там в профиль
            ведёт кнопка-имя в шапке. */}
        <div className="side-foot">
          {/* Статус синка + колокольчик уведомлений на десктопе живут здесь
              (шапка на десктопе скрыта). На мобиле этот блок скрыт — они в шапке. */}
          <div className="side-tools">
            <SyncTools unread={unread} onOpenNotif={() => goTab('notif')} />
          </div>
          <button
            className={'side-profile' + (tab === 'profile' ? ' active' : '')}
            onClick={() => goTab('profile')}
            aria-label="Открыть профиль"
          >
            <Avatar name={user.name} url={myCached?.avatar_url} className="avatar-sm" />
            <span className="side-profile-name">{user.name}</span>
          </button>
        </div>
      </nav>

      <Toast />
    </div>
  )
}
