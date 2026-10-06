import { useState, useEffect, useRef, Suspense } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { isConfigured, warmup } from './db/supabase.js'
import { enablePush } from './db/push.js'
import { stripPushParam } from './lib/pushIntent.js'
import PushAskSheet from './components/PushAskSheet.jsx'
import { startSync } from './db/sync.js'
import { countUnread } from './db/notifications.js'
import { getCachedUser } from './db/repo.js'
import { onResume } from './lib/appEvents.js'
import { myUnreadReplies } from './lib/feedbackApi.js'
import { fabState } from './lib/quickAdd.js'
import { useTabDot } from './hooks/useTabDot.js'
import { isNested } from './lib/screenNav.js'
import { useAccentSync } from './hooks/useAccentSync.js'
import LoginScreen from './screens/LoginScreen.jsx'
import InviteScreen from './screens/InviteScreen.jsx'
import { inviteFromUrl, stripInvite } from './lib/invite.js'
import { captureSource, clearPending } from './lib/joinRequest.js'
import Toast from './components/Toast.jsx'
import AddFab from './components/AddFab.jsx'
import Avatar from './components/Avatar.jsx'
import ScreenSkeleton from './components/ScreenSkeleton.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { lazyScreen } from './components/lazyScreen.jsx'
import WhatsNewSheet from './components/WhatsNewSheet.jsx'
import WelcomeSheet from './components/WelcomeSheet.jsx'
import { markWelcomePending } from './lib/welcome.js'
import SyncTools from './components/SyncTools.jsx'
import TabIcon from './components/TabIcon.jsx'
import ScreenCrash from './components/ScreenCrash.jsx'
import { useSession } from './hooks/useSession.js'
import { useAppNav } from './hooks/useAppNav.js'
import { useLaunchSheets } from './hooks/useLaunchSheets.js'

// Экраны-вкладки грузим лениво: код активной вкладки подтягивается по требованию.
// Главный выигрыш — «Прогресс» тянет тяжелый recharts, который теперь не попадает
// в стартовый бандл, а грузится отдельным чанком при открытии вкладки.
// Экраны ПРЕФЕТЧИМ в простое после входа (см. эффект ниже). Голый React.lazy для
// этого не годился: префетч грел чанк, но lazy все равно суспендился на первом
// рендере, и React 19 держал скелетон ~300 мс — задержка первого захода на каждую
// вкладку после холодного старта. lazyScreen после preload рендерит экран напрямую.
const HomeScreen = lazyScreen(() => import('./screens/HomeScreen.jsx'))
const HistoryScreen = lazyScreen(() => import('./screens/HistoryScreen.jsx'))
const ProgressScreen = lazyScreen(() => import('./screens/ProgressScreen.jsx'))
const FeedScreen = lazyScreen(() => import('./screens/FeedScreen.jsx'))
const NotificationsScreen = lazyScreen(() => import('./screens/NotificationsScreen.jsx'))
const ProfileScreen = lazyScreen(() => import('./screens/ProfileScreen.jsx'))
const AdminScreen = lazyScreen(() => import('./screens/AdminScreen.jsx'))
const FreshnessScreen = lazyScreen(() => import('./screens/FreshnessScreen.jsx'))
const MyExercisesScreen = lazyScreen(() => import('./screens/MyExercisesScreen.jsx'))
const AchievementsScreen = lazyScreen(() => import('./screens/AchievementsScreen.jsx'))
const AppearanceScreen = lazyScreen(() => import('./screens/AppearanceScreen.jsx'))
const WhatsNewScreen = lazyScreen(() => import('./screens/WhatsNewScreen.jsx'))
const FeedbackScreen = lazyScreen(() => import('./screens/FeedbackScreen.jsx'))
const MemberScreen = lazyScreen(() => import('./screens/MemberScreen.jsx'))

export default function App() {
  // Сессия (вход/выход/восстановление) — hooks/useSession.js.
  const { user, handleLogin, handleRenamed, handleLogout } = useSession(() => setTab('home'))
  // Навигация (вкладки, стек экранов, интенты, пуш) — hooks/useAppNav.js.
  const {
    tab, setTab, routeAnim, contentRef, screenRef, edgeSwipeOn,
    memberId, progressExId, setProgressExId, openNewWorkout, setOpenNewWorkout,
    calendarIntent, setCalendarIntent, feedFlashId, feedbackFocus, setFeedbackFocus,
    focusRhythm, setFocusRhythm, openSettings, setOpenSettings,
    goTab, openNotif, backFromNotif, openProgressFor, openCalendarAt, openMember, backFromMember,
    backToRhythm, backToSettings, startNewWorkout,
  } = useAppNav(user)
  // Ссылка-приглашение (v6.8.0): токен из #invite=… живет только в памяти —
  // из адреса стираем сразу (эффект ниже), чтобы он не остался в истории и закладках.
  // Пока токен есть, вместо входа показываем регистрацию.
  const [inviteToken, setInviteToken] = useState(() => inviteFromUrl(window.location.href))
  // Параметр `push` из адреса убираем сразу: иначе F5 снова открыл бы тренировку.
  useEffect(() => {
    const clean = stripPushParam(window.location.href)
    if (clean) window.history.replaceState(window.history.state, '', clean)
    const noInvite = stripInvite(window.location.href)
    if (noInvite) window.history.replaceState(window.history.state, '', noInvite)
    // Метка источника ?src= (v6.15.3): запомнить для заявки и убрать из адреса.
    const noSrc = captureSource(window.location.href)
    if (noSrc) window.history.replaceState(window.history.state, '', noSrc)
    // Ссылку открыли во вкладке, где приложение уже загружено: меняется только
    // фрагмент, страница не перезагружается — подхватываем токен здесь.
    const onHash = () => {
      const t = inviteFromUrl(window.location.href)
      if (!t) return
      setInviteToken(t)
      const clean = stripInvite(window.location.href)
      if (clean) window.history.replaceState(window.history.state, '', clean)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Хаб «Тренировки» ушел в свой под-вид (композер/деталь/шаблоны или режим
  // выбора для экспорта) — тогда FAB прячем: он там либо не нужен, либо налезает
  // на нижнюю панель («Сохранить» / бар экспорта). Хаб сообщает об этом сам.
  const [historyBusy, setHistoryBusy] = useState(false)

  // «Добро пожаловать», «Что нового» и вопрос про уведомления — hooks/useLaunchSheets.js.
  const { welcome, closeWelcome, whatsNew, closeWhatsNew, pushAsk, closePushAsk } = useLaunchSheets(user, historyBusy)
  // Строка новой версии (UpdatePrompt, вне App) не показывается посреди записи
  // тренировки — сообщаем ей через атрибут на <html> (CSS прячет).
  useEffect(() => {
    const root = document.documentElement
    if (historyBusy) root.dataset.composer = '1'
    else delete root.dataset.composer
  }, [historyBusy])

  // Счетчик непрочитанных рекордов-уведомлений (для бейджа на колокольчике).
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
  }, [myCached?.name, user?.id, user?.name, handleRenamed])

  // Будим базу заранее, как только приложение открылось
  useEffect(() => { warmup() }, [])

  // Фоновая синхронизация очереди и подтяжка свежих данных, пока есть вход.
  useEffect(() => {
    if (!user?.id) return
    return startSync(() => user.id)
  }, [user?.id])

  // Префетч экранов остальных вкладок в простое после входа: активная вкладка уже
  // грузится, а прочие подтягиваем заранее, чтобы их открытие было мгновенным и не
  // мелькал Suspense-скелетон. Повторный preload — no-op (общий промис).
  // Ошибки глотаем: префетч — оптимизация, не критичен.
  useEffect(() => {
    if (!user?.id) return
    const screens = [HomeScreen, HistoryScreen, FeedScreen, ProgressScreen, FreshnessScreen,
      NotificationsScreen, ProfileScreen, MyExercisesScreen, AchievementsScreen, AppearanceScreen,
      MemberScreen, FeedbackScreen]
    if (user.role === 'admin') screens.push(AdminScreen)
    const prefetch = () => { for (const s of screens) s.preload().catch(() => {}) }
    const ric = window.requestIdleCallback
    if (ric) {
      const id = ric(prefetch, { timeout: 3000 })
      return () => window.cancelIdleCallback?.(id)
    }
    const id = setTimeout(prefetch, 800)
    return () => clearTimeout(id)
  }, [user?.id, user?.role])

  // Нижнее меню: переезжающая точка активной вкладки (hooks/useTabDot.js).
  const navRef = useRef(null)
  useTabDot(navRef, tab)
  // Акцент учетки с других устройств (v6.2.0): применить и запомнить для сплэша.
  useAccentSync(user?.id ?? null)
  // Ответы разработчика для «Уведомлений» (v6.12.0): проверяем при входе и при
  // возврате в приложение — myUnreadReplies заодно кладет их в локальный кэш.
  // Тихо: нет сети или сессии — просто без обновления.
  useEffect(() => {
    if (!user?.id) return undefined
    const uid = user.id
    const check = () => { if (navigator.onLine !== false) myUnreadReplies(uid) }
    check()
    return onResume(check)
  }, [user?.id])
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

  if (inviteToken) {
    return (
      <InviteScreen
        token={inviteToken}
        signedInAs={user ? (user.name || 'без имени') : null}
        onRegistered={async (u) => { clearPending(); markWelcomePending(u?.id); await handleLogin(u); setInviteToken(null) }}
        onCancel={() => setInviteToken(null)}
        onSignOut={handleLogout}
      />
    )
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} onInvite={setInviteToken} />
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
        <SyncTools unread={unread} onOpenNotif={openNotif} />
      </header>

      <main className="content" ref={contentRef}>
        <div className="nav-stack" key={user.id}>
          {routeAnim.stack.map((route, index) => (
            <div key={route} data-route={route}
              className={route === tab ? 'nav-layer nav-current screen-anim screen-anim--' + routeAnim.kind : index === routeAnim.stack.length - 2 ? 'nav-layer nav-underlay' : 'nav-layer nav-hidden'}
              ref={route === tab ? screenRef : undefined}
              inert={route !== tab} aria-hidden={route !== tab ? true : undefined}>
              <Suspense fallback={<ScreenSkeleton />}>
            <ErrorBoundary fallback={(_err, reset) => <ScreenCrash onRetry={reset} />}>
              {route === 'home' && (
                <HomeScreen
                  user={user}
                  onNavigate={goTab}
                  onNewWorkout={startNewWorkout}
                  onOpenProgress={openProgressFor}
                  onOpenCalendar={openCalendarAt}
                  focusRhythm={focusRhythm}
                  onFocusRhythmConsumed={() => setFocusRhythm(false)}
                />
              )}
              {route === 'history' && (
                <HistoryScreen
                  user={user}
                  openNew={openNewWorkout}
                  onOpenNewConsumed={() => setOpenNewWorkout(false)}
                  openCalendar={calendarIntent}
                  onOpenCalendarConsumed={() => setCalendarIntent(false)}
                  onReturn={backToRhythm}
                  onBusyChange={setHistoryBusy}
                  onOpenProgress={openProgressFor}
                />
              )}
              {route === 'feed' && <FeedScreen user={user} onOpenMember={openMember} flashId={feedFlashId} />}
              {route === 'member' && memberId && (
                <MemberScreen user={user} memberId={memberId} onBack={backFromMember} />
              )}
              {route === 'progress' && (
                <ProgressScreen
                  user={user}
                  initialExerciseId={progressExId}
                  onConsumed={() => setProgressExId(null)}
                  onOpenGoals={() => goTab('profile')}
                />
              )}
              {route === 'notif' && (
                <NotificationsScreen user={user} onBack={backFromNotif}
                  onOpenFeedback={(id) => { setFeedbackFocus(id); goTab('feedback') }} />
              )}
              {route === 'profile' && (
                <ProfileScreen
                  user={user}
                  onLogout={handleLogout}
                  onOpenProgress={openProgressFor}
                  onOpenFeed={() => goTab('feed')}
                  onRenamed={handleRenamed}
                  onOpenAdmin={() => goTab('admin')}
                  onOpenMyExercises={() => goTab('myex')}
                  onOpenAchievements={() => goTab('achievements')}
                  onOpenAppearance={() => goTab('appearance')}
                  onOpenWhatsNew={() => goTab('whatsnew')}
                  onOpenFeedback={() => goTab('feedback')}
                  contentRef={contentRef}
                  edgeSwipeOn={edgeSwipeOn && route === tab}
                  startInSettings={openSettings}
                  onStartInSettingsConsumed={() => setOpenSettings(false)}
                />
              )}
              {route === 'admin' && user.role === 'admin' && (
                <AdminScreen user={user} onBack={() => goTab('profile')} />
              )}
              {route === 'freshness' && (
                <FreshnessScreen user={user} onBack={() => goTab('home')} />
              )}
              {route === 'myex' && (
                <MyExercisesScreen user={user} onBack={backToSettings} />
              )}
              {route === 'achievements' && (
                <AchievementsScreen user={user} onBack={() => goTab('profile')} />
              )}
              {route === 'whatsnew' && (
                <WhatsNewScreen onBack={backToSettings} />
              )}
              {route === 'appearance' && (
                <AppearanceScreen user={user} onBack={backToSettings} />
              )}
              {route === 'feedback' && (
                <FeedbackScreen user={user} focusId={feedbackFocus} onBack={() => goTab('profile')}
                  fromScreen={routeAnim.stack.find((t) => !isNested(t)) ?? null} />
              )}
            </ErrorBoundary>
              </Suspense>
            </div>
          ))}
        </div>
      </main>

      <nav className="tabbar" ref={navRef}>
        {/* Общая точка активной вкладки — переезжает (hooks/useTabDot.js). */}
        <span className="tab-dot" aria-hidden="true" />
        {/* Бренд-шапка сайдбара: видна только на десктопе (≥900px), где .tabbar
            превращается в левую колонку. На мобиле скрыта (display:none). Кликабельна
            — ведет на Главную. */}
        <button
          className="side-brand"
          onClick={() => goTab('home')}
          aria-label="На главную"
        >
          <span className="side-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round"><path d="M1.5 12h21" /><rect x="3" y="8.5" width="2.6" height="7" rx="1" fill="currentColor" stroke="none" /><rect x="6.4" y="6" width="3" height="12" rx="1.2" fill="currentColor" stroke="none" /><rect x="14.6" y="6" width="3" height="12" rx="1.2" fill="currentColor" stroke="none" /><rect x="18.4" y="8.5" width="2.6" height="7" rx="1" fill="currentColor" stroke="none" /></svg>
          </span>
          <span className="side-brand-txt">Журнал тренировок</span>
        </button>
        {/* Десктоп (≥900px, v6.2.3): явная «+ Новая тренировка» — круглой «+» меню там
            нет. На мобиле скрыта. Пока открыт композер/экспорт — неактивна, как «+». */}
        <button
          className="side-new"
          onClick={startNewWorkout}
          disabled={fabState({ busy: historyBusy }) === 'sunk'}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
            strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          Новая тренировка
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
        {/* «+» по центру меню (редизайн v6): запись тренировки в один тап. Есть
            ВСЕГДА (v6.0.4, в т.ч. на вложенных роутах); когда хаб занят (композер /
            экспорт) — утоплен и неактивен, см. lib/quickAdd.js fabState. */}
        <AddFab onClick={startNewWorkout} sunk={fabState({ busy: historyBusy }) === 'sunk'} />
        <button
          className={tab === 'feed' || tab === 'member' ? 'tab active' : 'tab'}
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
            ведет кнопка-имя в шапке. */}
        <div className="side-foot">
          {/* Статус синка + колокольчик уведомлений на десктопе живут здесь
              (шапка на десктопе скрыта). На мобиле этот блок скрыт — они в шапке. */}
          <div className="side-tools">
            <SyncTools unread={unread} onOpenNotif={openNotif} />
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
      {/* «Что нового» — не поверх записи тренировки: дождемся выхода из композера. */}
      {/* Новичку — сначала приветствие (v6.15.0); «Что нового» ему и так не показываем. */}
      {welcome && !historyBusy && (
        <WelcomeSheet onClose={closeWelcome} onStart={() => { closeWelcome(); startNewWorkout() }} />
      )}
      {whatsNew && !welcome && !historyBusy && (
        <WhatsNewSheet
          release={whatsNew}
          onDone={closeWhatsNew}
          onOpenAll={() => { closeWhatsNew(); goTab('whatsnew') }}
        />
      )}
      {pushAsk && !welcome && !whatsNew && !historyBusy && (
        <PushAskSheet onEnable={() => enablePush(user.id)} onClose={closePushAsk} />
      )}
    </div>
  )
}
