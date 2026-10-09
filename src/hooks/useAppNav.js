import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { pushIntentFromUrl } from '../lib/pushIntent.js'
import { emitReselect } from '../lib/appEvents.js'
import { transitionKind, isNested, edgeSwipeSupported, nextScreenStack, initialScreenStack } from '../lib/screenNav.js'
import { isIOSDevice } from '../lib/pushSupport.js'
import { storageGet, storageSet } from '../lib/safeStorage.js'
import { captureAnchor, useScrollAnchorRestore } from './useScrollAnchor.js'
import { useEdgeSwipeBack } from './useEdgeSwipeBack.js'
import { settleScroll } from '../lib/scrollBox.js'

// Навигация приложения (вынесено из App.jsx в v6.14.1, код — дословно): активная
// вкладка и стек вложенных экранов (анимация, прокрутка, свайп «назад»), одноразовые
// интенты для экранов (новая тренировка, календарь, упражнение в Прогрессе, возврат
// к Настройкам/Ритму, подсветка в Ленте, фокус обращения) и применение пуша после
// входа. Новый вложенный роут — в NESTED_ROUTES (lib/screenNav.js) и в nestedBack().
// Поведение держит App.nav.test.jsx.

// Сколько горит подсветка карточки, к которой привел пуш (мс).
const FEED_FLASH_MS = 2400
// Якорь «к тренировке из пуша»: карточка встает чуть ниже верха экрана. Ждем ее
// дольше обычного возврата — при холодном старте Лента еще грузит экран и кэш.
const pushAnchor = (workoutId) => ({ anchor: `feed-${workoutId}`, offset: 12, scrollTop: 0, ms: 2500 })
const TAB_KEY = 'gym_app_tab'

export function useAppNav(user) {
  // Нажатие на пуш (v6.7.2): service worker открывает приложение с `?push=<tag>`
  // или, если оно уже открыто, присылает сообщение. Намерение ждет входа и
  // применяется один раз (см. эффект ниже); до входа просто лежит.
  const [pushIntent, setPushIntent] = useState(() => pushIntentFromUrl(window.location.href))
  // Активная вкладка переживает F5 (sessionStorage). Дефолт — 'home' (Главная,
  // «5 секунд после открытия»). Старое значение 'workout' (вкладки больше нет)
  // проваливается в дефолт.
  const [tab, setTab] = useState(() => {
    // Холодный старт с пуша о реакции — сразу Лента, без кадра Главной.
    if (pushIntentFromUrl(window.location.href)?.type === 'reaction') return 'feed'
    const saved = storageGet('sessionStorage', TAB_KEY)
    if (saved === 'member') return 'feed' // id участника не переживает F5 → назад в Ленту
    return saved && saved !== 'workout' ? saved : 'home'
  }) // 'home' | 'history' | 'feed' | 'progress' | 'notif' | 'profile' | 'admin' | 'freshness' | 'myex' | 'achievements' | 'appearance' | 'pushset'

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

  // Подсветка карточки Ленты, к которой привел пуш о реакции (v6.7.3): id
  // тренировки на пару секунд, потом гаснет сама.
  const [feedFlashId, setFeedFlashId] = useState(null)
  // Обращение, к которому привел пуш с ответом разработчика (v6.11.0).
  const [feedbackFocus, setFeedbackFocus] = useState(null)
  useEffect(() => {
    if (!feedFlashId) return
    const t = setTimeout(() => setFeedFlashId(null), FEED_FLASH_MS)
    return () => clearTimeout(t)
  }, [feedFlashId])

  // Уже открытое приложение: адрес не меняется, service worker шлет сообщение.
  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    const onMessage = (e) => {
      if (e.data?.type !== 'push-open') return
      const intent = pushIntentFromUrl(e.data.url)
      if (intent) setPushIntent(intent)
      // Подтверждение для SW (v6.7.4): без него он перезагрузит окно на адрес пуша.
      e.ports?.[0]?.postMessage('ok')
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

  // Запоминаем активную вкладку
  useEffect(() => { storageSet('sessionStorage', TAB_KEY, tab) }, [tab])

  // Скроллится не окно, а внутренняя .content (overflow-y:auto, см. index.css).
  // Тап по кнопке вкладки всегда возвращает ее контент в самый верх — в т.ч.
  // повторный тап по уже активной вкладке (как «прокрутка наверх» в iOS).
  const contentRef = useRef(null)
  // Текущий экран (.screen-anim) — его двигает свайп назад от края.
  const screenRef = useRef(null)
  // Вкладки — fade, вход во вложенный экран — сдвиг справа. Предки остаются
  // смонтированными для свайпа: возврат раскрывает их без новой анимации входа.
  // Производное от прошлого рендера храним в состоянии, без чтения ref в рендере.
  const [routeAnim, setRouteAnim] = useState({ tab, kind: 'fade', stack: initialScreenStack(tab) })
  if (routeAnim.tab !== tab) setRouteAnim({ tab, kind: routeAnim.stack.includes(tab) ? 'pop' : transitionKind(routeAnim.tab, tab), stack: nextScreenStack(routeAnim.stack, tab) })
  // Свайп назад — только iOS «на экране Домой»: там у системы своего жеста нет.
  const [edgeSwipeOn] = useState(() => {
    try {
      const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
      return edgeSwipeSupported({ isIOS: isIOSDevice(navigator), standalone })
    } catch { return false }
  })
  // Сбрасываем позицию ПОСЛЕ React-commit нового экрана. requestAnimationFrame
  // из обработчика мог сработать еще на длинном Профиле до commit вкладки, и
  // «Прогресс» наследовал нижнюю позицию скролла.
  // settleScroll (v6.15.0): на iPhone обычный scrollTo во время инерции игнорировался —
  // новый экран вставал внизу или пустым до тапа.
  useLayoutEffect(() => {
    const top = routeAnim.kind === 'pop' ? Number(screenRef.current?.dataset.scrollTop || 0) : 0
    return settleScroll(contentRef.current, top)
  }, [tab, routeAnim.kind])
  // …кроме возврата из профиля участника: Лента встает туда, откуда ушли.
  useScrollAnchorRestore(contentRef, tab === 'feed' ? feedRestore : null, () => setFeedRestore(null))

  function goTab(next) {
    if (screenRef.current) screenRef.current.dataset.scrollTop = String(contentRef.current?.scrollTop || 0)
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

  // «Уведомления» открываются колокольчиком с любой вкладки — «назад» ведет туда,
  // откуда пришли (РЕВЬЮ-КОДА-2026-10-02: у экрана не было общей BackButton).
  // После F5 на самом экране источника нет — на Главную.
  const notifFromRef = useRef(null)
  function openNotif() {
    if (tab !== 'notif') notifFromRef.current = tab
    goTab('notif')
  }
  function backFromNotif() {
    goTab(notifFromRef.current ?? 'home')
    notifFromRef.current = null
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

  // «Назад» вложенного экрана — тот же, что у его кнопки «‹» (см. рендер ниже).
  function nestedBack() {
    switch (tab) {
      case 'notif': return backFromNotif()
      case 'member': return backFromMember()
      case 'freshness': return goTab('home')
      case 'admin': case 'achievements': case 'feedback': case 'circle': return goTab('profile')
      case 'myex': case 'whatsnew': case 'appearance': case 'pushset': return backToSettings()
      default: return undefined
    }
  }
  useEdgeSwipeBack(contentRef, screenRef, nestedBack, edgeSwipeOn && Boolean(user) && isNested(tab))

  // Применяем намерение пуша, когда человек вошел: Лента + прокрутка к оцененной
  // тренировке тем же якорем, что «Назад» из профиля друга. Карточки нет (старше
  // окна Ленты) — якорь не найдется, и Лента встанет в начало. Идем в обход goTab:
  // на уже открытой Ленте тот прислал бы `reselect` и уехал бы наверх.
  useEffect(() => {
    if (!user?.id || !pushIntent) return
    if (pushIntent.type === 'reaction') {
      setFeedRestore(pushAnchor(pushIntent.workoutId))
      setFeedFlashId(pushIntent.workoutId)
      setTab('feed')
    }
    // Ответ на обращение (v6.11.0) — экран обратной связи с подсветкой этого обращения.
    if (pushIntent.type === 'feedback') {
      setFeedbackFocus(pushIntent.feedbackId)
      setTab('feedback')
    }
    setPushIntent(null)
  }, [user?.id, pushIntent])

  function startNewWorkout() {
    setOpenNewWorkout(true)
    if (tab === 'history') {
      settleScroll(contentRef.current, 0)
      return
    }
    goTab('history')
  }


  return {
    tab, setTab, routeAnim, contentRef, screenRef, edgeSwipeOn,
    memberId, feedRestore, progressExId, setProgressExId, openNewWorkout, setOpenNewWorkout,
    calendarIntent, setCalendarIntent, feedFlashId, feedbackFocus, setFeedbackFocus,
    focusRhythm, setFocusRhythm, openSettings, setOpenSettings,
    goTab, openNotif, backFromNotif, openProgressFor, openCalendarAt, openMember, backFromMember,
    backToRhythm, backToSettings, nestedBack, startNewWorkout, setPushIntent
  }
}
