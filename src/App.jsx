import { useState, useEffect, useLayoutEffect, useRef, Suspense } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { isConfigured, warmup, supabase } from './db/supabase.js'
import { logout as authLogout, getCachedProfile } from './lib/auth.js'
import { releasePushOnLogout, getPushState, enablePush, wasPushAsked, markPushAsked } from './db/push.js'
import { shouldAskPush } from './lib/pushSupport.js'
import { pushIntentFromUrl, stripPushParam } from './lib/pushIntent.js'
import PushAskSheet from './components/PushAskSheet.jsx'
import { startSync, useSyncStatus } from './db/sync.js'
import { countUnread } from './db/notifications.js'
import { getCachedUser } from './db/repo.js'
import { openUserDb, closeUserDb } from './db/local.js'
import { syncBadgeState } from './lib/syncStatus.js'
import { readStoredUserId, hydrateProfile } from './lib/sessionProfile.js'
import { emitReselect } from './lib/appEvents.js'
import { markAppReady } from './lib/splash.js'
import { fabState } from './lib/quickAdd.js'
import { useTabDot } from './hooks/useTabDot.js'
import { captureAnchor, useScrollAnchorRestore } from './hooks/useScrollAnchor.js'
import { useAccentSync } from './hooks/useAccentSync.js'
import LoginScreen from './screens/LoginScreen.jsx'
import Toast, { showToast } from './components/Toast.jsx'
import AddFab from './components/AddFab.jsx'
import Avatar from './components/Avatar.jsx'
import ScreenSkeleton from './components/ScreenSkeleton.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { lazyScreen } from './components/lazyScreen.jsx'
import { useSpinPhase } from './hooks/useSpinPhase.js'
import WhatsNewSheet from './components/WhatsNewSheet.jsx'
import { WHATS_NEW } from './content/whatsNew.js'
import { pendingWhatsNew, mergeForSheet, readMark, writeMark, SEEN_KEY } from './lib/whatsNew.js'

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
const MemberScreen = lazyScreen(() => import('./screens/MemberScreen.jsx'))

// Иконка состояния синхронизации — инлайн-SVG (без зависимостей), как TabIcon.
// Красится через currentColor (цвет задает класс .sync-badge.<cls>), спиннер
// крутит CSS (.sync-ico.spin).
function SyncIcon({ name }) {
  const spinStyle = useSpinPhase(name === 'syncing')
  const p = {
    className: name === 'syncing' ? 'sync-ico spin' : 'sync-ico',
    style: spinStyle,
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
  // карточки висят с желтым кружком. netError — последний прогон синка упал по сети
  // (напр. таймаут в авиарежиме при online=true): тоже предупреждение, а не галочка.
  const { cls, icon, text, title } = syncBadgeState({ online, syncing, pending, dead, netError })
  return (
    <span className={`sync-badge ${cls}`} role="status" aria-label={title} title={title}>
      <SyncIcon name={icon} />
      {text && <span className="sync-badge-txt">{text}</span>}
    </span>
  )
}

// Статус синхронизации + колокольчик уведомлений — единый блок. Живет и в шапке
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
// плавную смену цвета и легкое увеличение активной задает CSS (.tab / .tab-ico).
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
      <path d="M1.5 12h21" /><rect x="3" y="8.5" width="2.6" height="7" rx="1" fill="currentColor" stroke="none" /><rect x="6.4" y="6" width="3" height="12" rx="1.2" fill="currentColor" stroke="none" /><rect x="14.6" y="6" width="3" height="12" rx="1.2" fill="currentColor" stroke="none" /><rect x="18.4" y="8.5" width="2.6" height="7" rx="1" fill="currentColor" stroke="none" />
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
// Живет внутри <main>, поэтому шапка и таббар остаются — можно уйти на другую
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
// заново лишь когда refresh-токен умрет (~7 дней) или после logout.
const SESSION_KEY = 'gym_app_user'
const TAB_KEY = 'gym_app_tab'

export default function App() {
  const [user, setUser] = useState(null)
  // Нажатие на пуш (v6.7.2): service worker открывает приложение с `?push=<tag>`
  // или, если оно уже открыто, присылает сообщение. Намерение ждет входа и
  // применяется один раз (см. эффект ниже); до входа просто лежит.
  const [pushIntent, setPushIntent] = useState(() => pushIntentFromUrl(window.location.href))
  // Активная вкладка переживает F5 (sessionStorage). Дефолт — 'home' (Главная,
  // «5 секунд после открытия»). Старое значение 'workout' (вкладки больше нет)
  // проваливается в дефолт.
  const [tab, setTab] = useState(() => {
    // Холодный старт с пуша о реакции — сразу «Тренировки», без кадра Главной.
    if (pushIntentFromUrl(window.location.href)?.type === 'workout') return 'history'
    const saved = sessionStorage.getItem(TAB_KEY)
    if (saved === 'member') return 'feed' // id участника не переживает F5 → назад в Ленту
    return saved && saved !== 'workout' ? saved : 'home'
  }) // 'home' | 'history' | 'feed' | 'progress' | 'notif' | 'profile' | 'admin' | 'freshness' | 'myex' | 'achievements' | 'appearance'

  // Чей профиль открыт на вложенном роуте 'member' (v6.7.0, тап по участнику в Ленте/рейтинге).
  const [memberId, setMemberId] = useState(null)
  // Откуда ушли в профиль (v6.7.1): якорь прокрутки Ленты — «Назад» возвращает к той
  // же карточке/строке рейтинга, а не в начало Ленты.
  const feedAnchorRef = useRef(null)
  const [feedRestore, setFeedRestore] = useState(null)

  // Упражнение, с которым открыть «Прогресс» (проброс из ЛК по тапу на рекорд).
  const [progressExId, setProgressExId] = useState(null)

  // Интент «открой сразу новую тренировку» для хаба «Тренировки» (тот же прием,
  // что и progressExId: одноразовый флаг, хаб его считывает и гасит через
  // onOpenNewConsumed). Взводится плавающей кнопкой «+» и кнопками Главной —
  // так запись начинается в ОДИН тап, минуя список.
  const [openNewWorkout, setOpenNewWorkout] = useState(false)

  // Интент «открой календарь тренировок» (v6.3.0, ссылка из Ритма Главной).
  // false — нет интента; null — календарь на сегодня; 'YYYY-MM-DD' — сразу этот день.
  const [calendarIntent, setCalendarIntent] = useState(false)

  // Интент «открой эту тренировку» (v6.7.2, нажатие на пуш о реакции): id для хаба
  // «Тренировки», тот его считывает и гасит. Нет тренировки на устройстве — ведем
  // в «Уведомления», где реакция тоже есть.
  const [openWorkoutId, setOpenWorkoutId] = useState(null)

  // Параметр `push` из адреса убираем сразу: иначе F5 снова открыл бы тренировку.
  useEffect(() => {
    const clean = stripPushParam(window.location.href)
    if (clean) window.history.replaceState(window.history.state, '', clean)
  }, [])

  // Уже открытое приложение: адрес не меняется, service worker шлет сообщение.
  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    const onMessage = (e) => {
      if (e.data?.type !== 'push-open') return
      const intent = pushIntentFromUrl(e.data.url)
      if (intent) setPushIntent(intent)
    }
    sw.addEventListener('message', onMessage)
    return () => sw.removeEventListener('message', onMessage)
  }, [])

  // Вернуться из календаря/тренировки обратно к Ритму Главной (v6.3.5): Главная
  // докручивает до блока «Ритм» и гасит флаг.
  const [focusRhythm, setFocusRhythm] = useState(false)

  // Под-экраны Настроек (Оформление, Каталог, Админка) возвращают к списку Настроек,
  // а не в корень Профиля (v6.3.5). Одноразовый интент, Профиль его гасит.
  const [openSettings, setOpenSettings] = useState(false)

  // Хаб «Тренировки» ушел в свой под-вид (композер/деталь/шаблоны или режим
  // выбора для экспорта) — тогда FAB прячем: он там либо не нужен, либо налезает
  // на нижнюю панель («Сохранить» / бар экспорта). Хаб сообщает об этом сам.
  const [historyBusy, setHistoryBusy] = useState(false)

  // «Что нового» (v6.4.0): лист один раз после обновления. knownDevice — сессия
  // была ДО запуска (тут уже входили): тогда при пустой отметке покажем свежую
  // запись, а новичку/новому телефону — молча запомним версию (lib/whatsNew.js).
  const knownDeviceRef = useRef(null)
  if (knownDeviceRef.current === null) {
    try { knownDeviceRef.current = Boolean(readStoredUserId(localStorage.getItem(SESSION_KEY))) } catch { knownDeviceRef.current = false }
  }
  const [whatsNew, setWhatsNew] = useState(null)
  useEffect(() => {
    if (!user?.id) return
    const { show, markSeen } = pendingWhatsNew(WHATS_NEW, readMark(SEEN_KEY), __APP_VERSION__, {
      knownDevice: knownDeviceRef.current,
    })
    if (markSeen) writeMark(SEEN_KEY, markSeen)
    setWhatsNew(mergeForSheet(show))
  }, [user?.id])
  function closeWhatsNew() {
    writeMark(SEEN_KEY, __APP_VERSION__)
    setWhatsNew(null)
  }
  // Разовый вопрос «Включить уведомления?» (v6.6.1): после входа/обновления, когда
  // лист «Что нового» уже закрыт и человек не пишет тренировку. Один раз на учетку
  // на этом устройстве; «Не сейчас» — больше не спрашиваем (есть тумблер в Настройках).
  const [pushAsk, setPushAsk] = useState(false)
  useEffect(() => {
    if (!user?.id || whatsNew || historyBusy || pushAsk) return
    if (wasPushAsked(user.id)) return
    let alive = true
    const t = setTimeout(async () => {
      try {
        const s = await getPushState(user.id)
        if (alive && shouldAskPush({ ...s, asked: wasPushAsked(user.id) })) setPushAsk(true)
      } catch { /* не спросим сейчас — спросим при следующем запуске */ }
    }, 1200)
    return () => { alive = false; clearTimeout(t) }
  }, [user?.id, whatsNew, historyBusy, pushAsk])
  function closePushAsk(enabled) {
    if (user?.id) markPushAsked(user.id)
    setPushAsk(false)
    if (enabled) showToast({ emoji: '🔔', title: 'Уведомления включены' })
  }
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

  // Префетч экранов остальных вкладок в простое после входа: активная вкладка уже
  // грузится, а прочие подтягиваем заранее, чтобы их открытие было мгновенным и не
  // мелькал Suspense-скелетон. Повторный preload — no-op (общий промис).
  // Ошибки глотаем: префетч — оптимизация, не критичен.
  useEffect(() => {
    if (!user?.id) return
    const screens = [HomeScreen, HistoryScreen, FeedScreen, ProgressScreen, FreshnessScreen,
      NotificationsScreen, ProfileScreen, MyExercisesScreen, AchievementsScreen, AppearanceScreen,
      MemberScreen]
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

  // Скроллится не окно, а внутренняя .content (overflow-y:auto, см. index.css).
  // Тап по кнопке вкладки всегда возвращает ее контент в самый верх — в т.ч.
  // повторный тап по уже активной вкладке (как «прокрутка наверх» в iOS).
  const contentRef = useRef(null)
  // Нижнее меню: переезжающая точка активной вкладки (hooks/useTabDot.js).
  const navRef = useRef(null)
  useTabDot(navRef, tab)
  // Акцент учетки с других устройств (v6.2.0): применить и запомнить для сплэша.
  useAccentSync(user?.id ?? null)
  // Сбрасываем позицию ПОСЛЕ React-commit нового экрана. requestAnimationFrame
  // из обработчика мог сработать еще на длинном Профиле до commit вкладки, и
  // «Прогресс» наследовал нижнюю позицию скролла.
  useLayoutEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [tab])
  // …кроме возврата из профиля участника: Лента встает туда, откуда ушли.
  useScrollAnchorRestore(contentRef, tab === 'feed' ? feedRestore : null, () => setFeedRestore(null))

  function goTab(next) {
    // Повторный тап по уже открытой вкладке — контент не меняется: плавно
    // возвращаем его наверх (как «прокрутка к началу» в iOS) + сигнал «обнови меня»
    // (напр. Лента перезапрашивает посты).
    if (next === tab) {
      contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      emitReselect(next)
      return
    }
    // Переход на другую вкладку. Прокрутку после commit делает layout-effect
    // выше: обработчик не пытается угадать момент рендера через rAF.
    setTab(next)
  }

  // Связка ЛК → «Прогресс»: открыть вкладку с заранее выбранным упражнением.
  function openProgressFor(exerciseId) {
    setProgressExId(exerciseId)
    goTab('progress')
  }

  // «Записать тренировку» откуда угодно: взводим интент и уходим на вкладку
  // «Тренировки» — хаб при монтировании/обновлении сразу откроет композер.
  // Порядок важен: интент ставим ДО смены вкладки, иначе хаб успеет отрисовать
  // список и мелькнет лишний кадр.
  // Если вкладка «Тренировки» уже открыта (FAB висит над списком), идем в обход
  // goTab: тот на повторном тапе шлет `reselect`, а хаб теперь понимает его как
  // «вернись к списку» и погасил бы только что взведенный интент. Прокрутку
  // наверх делаем сами — смены вкладки, а значит и layout-эффекта, не будет.
  function openCalendarAt(day) {
    setCalendarIntent(day ?? null)
    goTab('history')
  }

  // Профиль участника из Ленты/рейтинга. Свой — это обычный «Профиль».
  function openMember(id, anchor) {
    if (!id) return
    if (id === user?.id) { goTab('profile'); return }
    feedAnchorRef.current = tab === 'feed' ? captureAnchor(contentRef.current, anchor) : null
    setMemberId(id)
    goTab('member')
  }

  function backFromMember() {
    setFeedRestore(feedAnchorRef.current)
    goTab('feed')
  }

  function backToRhythm() {
    setFocusRhythm(true)
    goTab('home')
  }

  function backToSettings() {
    setOpenSettings(true)
    goTab('profile')
  }

  // Применяем намерение пуша, когда человек вошел. Идем в обход goTab: на уже
  // открытых «Тренировках» тот прислал бы `reselect`, и хаб вернулся бы к списку.
  useEffect(() => {
    if (!user?.id || !pushIntent) return
    if (pushIntent.type === 'workout') {
      setOpenWorkoutId(pushIntent.workoutId)
      setTab('history')
    }
    setPushIntent(null)
  }, [user?.id, pushIntent])

  function startNewWorkout() {
    setOpenNewWorkout(true)
    if (tab === 'history') {
      contentRef.current?.scrollTo({ top: 0 })
      return
    }
    goTab('history')
  }

  // Восстановление профиля после перезапуска. В localStorage лежит только id;
  // имя берем из ростера (loginDb.users, свежий после pull), роль — из офлайн-
  // кэша PIN (в ростер роль не отдается). Работает офлайн (оба источника
  // локальные). Персональную базу открываем ДО setUser, иначе экраны/синк
  // прочитают еще закрытый `db`. Старый «толстый» блок {id,name,role} читаем по
  // id и тут же перезаписываем тонким — стираем утекшие имя/роль.
  // Готовность для сплэша (markAppReady) — по итогу восстановления: без этого
  // сплэш снимался по таймеру и мельком показывал экран входа, пока база открывалась.
  useEffect(() => {
    const id = readStoredUserId(localStorage.getItem(SESSION_KEY))
    if (!id) { markAppReady(); return }
    ;(async () => {
      const [roster, cache] = await Promise.all([getCachedUser(id), getCachedProfile(id)])
      await openUserDb(id)
      localStorage.setItem(SESSION_KEY, JSON.stringify({ id }))
      setUser(hydrateProfile(id, roster, cache))
    })()
      // Не глушим молча: человек окажется на экране входа, и без следа в консоли
      // такие случаи (напр. не открылась персональная база) не разобрать.
      .catch((err) => console.error('Не удалось восстановить сессию:', err))
      .finally(markAppReady)
  }, [])

  // Если сессия Supabase завершилась (refresh-токен истек через ~7 дней или
  // logout) — возвращаем на экран входа. Офлайн событие не приходит, поэтому
  // UI остается доступным до появления сети (тогда либо тихий перевыпуск, либо
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
    // закроет базу предыдущей учетки и перенесет несинхрон. правки со старой общей
    // базы. Чистка кросс-пользовательских кэшей больше не нужна — изоляция физическая.
    await openUserDb(u.id)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id: u.id }))
    setUser(u)
    setTab('home')
  }

  // Имя сменили в ЛК — обновляем профиль в стейте, чтобы шапка и инициал-аватар
  // сразу показали новое имя. Персистить в localStorage не нужно (там только id):
  // новое имя переживет перезапуск через ростер/офлайн-кэш PIN (setName их пишет).
  function handleRenamed(name) {
    setUser((u) => (u ? { ...u, name } : u))
  }

  async function handleLogout() {
    // Пуши этой учетки на устройство больше не нужны (общий телефон). Пока сессия
    // жива — снимаем подписку и на сервере; никогда не бросает, ждет не дольше 4 с.
    if (user?.id) await releasePushOnLogout(user.id)
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
              ErrorBoundary внутри этой обертки изолирует падение одной вкладки:
              шапка/таббар (вне <main>) живут, а смена вкладки размонтирует
              боундари (новый key) и тем самым сбрасывает ошибку. */}
          <div className="screen-anim" key={tab}>
            <ErrorBoundary fallback={(_err, reset) => <ScreenCrash onRetry={reset} />}>
              {tab === 'home' && (
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
              {tab === 'history' && (
                <HistoryScreen
                  user={user}
                  openNew={openNewWorkout}
                  onOpenNewConsumed={() => setOpenNewWorkout(false)}
                  openCalendar={calendarIntent}
                  onOpenCalendarConsumed={() => setCalendarIntent(false)}
                  openWorkout={openWorkoutId}
                  onOpenWorkoutConsumed={() => setOpenWorkoutId(null)}
                  onOpenWorkoutMissing={() => goTab('notif')}
                  onReturn={backToRhythm}
                  onBusyChange={setHistoryBusy}
                  onOpenProgress={openProgressFor}
                />
              )}
              {tab === 'feed' && <FeedScreen user={user} onOpenMember={openMember} />}
              {tab === 'member' && memberId && (
                <MemberScreen user={user} memberId={memberId} onBack={backFromMember} />
              )}
              {tab === 'progress' && (
                <ProgressScreen
                  user={user}
                  initialExerciseId={progressExId}
                  onConsumed={() => setProgressExId(null)}
                  onOpenGoals={() => goTab('profile')}
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
                  onOpenAppearance={() => goTab('appearance')}
                  onOpenWhatsNew={() => goTab('whatsnew')}
                  startInSettings={openSettings}
                  onStartInSettingsConsumed={() => setOpenSettings(false)}
                />
              )}
              {tab === 'admin' && user.role === 'admin' && (
                <AdminScreen user={user} onBack={backToSettings} />
              )}
              {tab === 'freshness' && (
                <FreshnessScreen user={user} onBack={() => goTab('home')} />
              )}
              {tab === 'myex' && (
                <MyExercisesScreen user={user} onBack={backToSettings} />
              )}
              {tab === 'achievements' && (
                <AchievementsScreen user={user} onBack={() => goTab('profile')} />
              )}
              {tab === 'whatsnew' && (
                <WhatsNewScreen onBack={backToSettings} />
              )}
              {tab === 'appearance' && (
                <AppearanceScreen user={user} onBack={backToSettings} />
              )}
            </ErrorBoundary>
          </div>
        </Suspense>
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
      {/* «Что нового» — не поверх записи тренировки: дождемся выхода из композера. */}
      {whatsNew && !historyBusy && (
        <WhatsNewSheet
          release={whatsNew}
          onDone={closeWhatsNew}
          onOpenAll={() => { closeWhatsNew(); goTab('whatsnew') }}
        />
      )}
      {pushAsk && !whatsNew && !historyBusy && (
        <PushAskSheet onEnable={() => enablePush(user.id)} onClose={closePushAsk} />
      )}
    </div>
  )
}
