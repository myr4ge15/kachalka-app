// ============================================================================
// Сплэш холодного старта (#splash в index.html) и блок «Обновляем до v…» на нем.
// Вынесено из main.jsx (покрытие тестами 19.10.2026): склейку сплэша с обновлением
// при запуске раньше не проверял ни один тест. DOM и таймеры приходят параметрами,
// тест — splashBoot.test.js (jsdom).
//
// Сплэш убираем, когда App сообщил о готовности (восстановил сессию или показал
// вход, см. markAppReady), но не раньше, чем доиграет анимация (lib/splash.js), и
// не позже страховочного потолка. Сначала гасим прозрачностью (.splash--out),
// затем удаляем узел.
//
// Обновление при запуске (v6.13.0, lib/launchUpdate.js): пока на сервере новая
// версия качается и применяется, сплэш держим — человек попадает сразу в новую
// версию. Сплэш уходит, когда И приложение готово, И проверка обновления
// закончилась (у нее свой потолок ожидания); страховочный потолок отсчитывается
// от конца проверки.
// ============================================================================
import { splashDelay, SPLASH_FADE_MS, SPLASH_MAX_MS } from './splash.js'
import { APPLY_TIMEOUT_MS, BAR_DONE_MAX_MS, MAX_WAIT_MS } from './launchUpdate.js'

// Не раньше конца самого долгого обновления: снятый сплэш и последующая перезагрузка — посреди работы.
// Последняя страховка от начала: что бы ни случилось с проверкой, сплэш не вечный.
export const SPLASH_HARD_MS = SPLASH_MAX_MS + MAX_WAIT_MS + APPLY_TIMEOUT_MS + BAR_DONE_MAX_MS

// splash — узел #splash; runUpdate(ui) → Promise<'skip'|'none'|'retried'|'fallback'|'applied'>.
export function startSplash({
  splash,
  doc = splash?.ownerDocument,
  reduce = false,
  onReady,
  runUpdate,
  now = () => performance.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
}) {
  if (!splash) return
  let gone = false
  let appReady = false
  let updateDone = false
  const hide = () => {
    if (gone) return
    gone = true
    splash.classList.add('splash--out')
    setTimer(() => splash.remove(), reduce ? 0 : SPLASH_FADE_MS)
  }
  // После обновления штанга уже собрана (.splash-resume, accent-boot.js) — ждать конца сборки незачем.
  const resumed = doc?.documentElement?.classList.contains('splash-resume')
  const maybeHide = () => { if (appReady && updateDone) setTimer(hide, splashDelay(now(), reduce || resumed)) }
  onReady(() => { appReady = true; maybeHide() })
  let check
  try { check = Promise.resolve(runUpdate(splashUpdateUi(doc, splash, { reduce }))) } catch { check = Promise.resolve('skip') }
  check
    .catch(() => 'skip')
    .then((result) => {
      if (result === 'applied') return // страница перезагружается
      updateDone = true
      maybeHide()
      setTimer(hide, SPLASH_MAX_MS)
    })
  setTimer(hide, SPLASH_HARD_MS)
}

// Блок «Обновляем до v…» на сплэше (разметка — index.html #splash-upd).
// Полоска догоняет загрузку плавно (20.10.2026, fb_afd6d919): файлы приходят пачками, и переход CSS
// к каждой новой точке шел рывками. Каждый кадр показанное значение подтягивается к цели: быстро, когда
// отстает сильно, и не медленнее BAR_MIN_SPEED (%/с), чтобы не замирать у самой цели. Цель не обгоняет.
// fb_d4103a75 (23.10.2026): все равно «рвано» — полоска догоняла каждый файл за доли секунды и стояла
// до следующего. Когда темп загрузки известен (pace, %/с — средний с первого файла), полоска идет ровно
// чуть медленнее него и ускоряется, только если отстала больше чем на BAR_LAG_OK.
export const BAR_RATE = 4 // доля отставания в секунду
export const BAR_MIN_SPEED = 15
export const BAR_PACE_SHARE = 0.9
export const BAR_LAG_OK = 8
export function barStep(shown, target, dtMs, pace = 0) {
  if (!(target > shown)) return target
  const dt = Math.max(0, Math.min(dtMs, 100)) / 1000
  const lag = target - shown
  const speed = pace > 0
    ? Math.max(pace * BAR_PACE_SHARE, (lag - BAR_LAG_OK) * BAR_RATE)
    : Math.max(lag * BAR_RATE, BAR_MIN_SPEED)
  return Math.min(target, shown + speed * dt)
}

// Полоска дошла до 100% — постоять перед перезагрузкой (26.10.2026): раньше страница уходила, пока полоска
// еще догоняла, и «100%» никто не видел. installing() возвращает обещание «дошла и постояла».
// 28.10.2026 (видео владельца, beta.101): последнее событие загрузки — 96%, а installing() сразу писал
// «Устанавливаем…» — подпись «Загружено 100%» не появлялась никогда. Теперь: полоска добегает с «Загружено 100%»,
// стоит BAR_HOLD_MS, потом «Устанавливаем…» еще INSTALL_HOLD_MS — и перезагрузка.
export const BAR_HOLD_MS = 500
// Не короче прыжка штанги (1 с, index.css): она успевает приземлиться, и перезагрузка не обрывает ее в воздухе.
export const INSTALL_HOLD_MS = 1000

// reduce — «уменьшить движение»: полоска сразу на месте. raf — кадры, now — часы (тест подставляет свои).
export function splashUpdateUi(doc, root, {
  reduce = false, raf, now = () => performance.now(), setTimer = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  const box = doc?.getElementById('splash-upd')
  const title = doc?.getElementById('splash-upd-title')
  const bar = doc?.getElementById('splash-upd-bar')
  const fill = doc?.getElementById('splash-upd-fill')
  const cap = doc?.getElementById('splash-upd-cap')
  if (!box || !title || !bar || !fill || !cap) return {}
  const frame = raf ?? doc.defaultView?.requestAnimationFrame?.bind(doc.defaultView)
  let shown = 0
  let target = 0
  let ticking = false
  let last = 0
  let pace = 0 // %/с — средний темп с первого файла (см. barStep)
  let first = null
  let onFull = null // ждет installing(): полоска на 100%
  const paint = () => {
    fill.style.width = `${Math.round(shown * 10) / 10}%`
    if (onFull && shown >= 100) {
      const done = onFull
      onFull = null
      setTimer(() => {
        cap.textContent = 'Устанавливаем…'
        // Прыжок кончается на земле: снимаем петлю на границе цикла, а не на полпути.
        root.querySelector('.splash-loop')?.addEventListener('animationiteration',
          () => root.classList.remove('splash--updating'), { once: true })
        setTimer(done, INSTALL_HOLD_MS)
      }, BAR_HOLD_MS)
    }
  }
  const tick = (t) => {
    shown = barStep(shown, target, last ? t - last : 16, pace)
    last = t
    paint()
    if (shown < target) frame(tick)
    else { ticking = false; last = 0 }
  }
  // Подпись «Загружено N%»: ширину держит невидимая копия финальной строки (см. progress).
  const loaded = (pct) => {
    const ghost = doc.createElement('span')
    ghost.className = 'splash-upd-ghost'
    ghost.setAttribute('aria-hidden', 'true')
    ghost.textContent = 'Загружено 100%'
    const live = doc.createElement('span')
    live.className = 'splash-upd-live'
    live.textContent = `Загружено ${pct}%`
    const capBox = doc.createElement('span')
    capBox.className = 'splash-upd-capbox'
    capBox.append(ghost, live)
    cap.replaceChildren(capBox)
  }
  const moveTo = (pct) => {
    target = Math.max(target, pct)
    if (reduce || !frame) { shown = target; paint(); return }
    if (!ticking) { ticking = true; frame(tick) }
  }
  return {
    start(version) {
      root.removeAttribute('aria-hidden') // статус должен услышать и скринридер
      // Штанга прыгает, пока качаем (v1.4.3, index.css .splash--updating) — но только после сборки.
      root.style.setProperty('--splash-loop-delay', `${splashDelay(now(), reduce)}ms`)
      root.classList.add('splash--updating')
      const versionLabel = doc.createElement('span')
      versionLabel.className = 'version-number'
      versionLabel.textContent = `v${version}`
      title.replaceChildren('Обновляем до ', versionLabel)
      cap.textContent = 'Загружаем…'
      bar.classList.add('splash-upd-bar--busy')
      box.hidden = false
    },
    progress(p) {
      if (!p) return
      bar.classList.remove('splash-upd-bar--busy')
      const t = now()
      if (!first) first = { t, pct: p.pct }
      else if (t - first.t >= 500 && p.pct > first.pct) pace = ((p.pct - first.pct) / (t - first.t)) * 1000
      moveTo(p.pct)
      bar.setAttribute('aria-valuenow', String(p.pct))
      // Подпись — проценты (26.10.2026): «30 из 32» — число файлов, человеку оно ничего не говорит.
      // По центру не дергается при «3%» → «13%» (20.10.2026) и не стоит с дырой (fb_afd6d919: рамка в ch
      // была шире цифры): ширину держит невидимая копия финальной строки «Загружено 100%», живая — от ее
      // левого края.
      loaded(p.pct)
    },
    installing() {
      bar.classList.remove('splash-upd-bar--busy')
      bar.setAttribute('aria-valuenow', '100')
      loaded(100) // «Устанавливаем…» — когда полоска дошла и постояла (paint)
      // Хвост — без темпа загрузки: при медленной сети последние проценты шли бы секундами.
      pace = 0
      return new Promise((resolve) => {
        onFull = resolve
        moveTo(100)
      })
    },
    fallback() {
      box.classList.add('splash-upd--note')
      title.textContent = 'Связь слабая'
      cap.textContent = 'Открываем текущую версию — обновление докачается само.'
    },
  }
}
