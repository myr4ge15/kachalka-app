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
import { WAIT_MS } from './launchUpdate.js'

// Последняя страховка от начала: что бы ни случилось с проверкой, сплэш не вечный.
export const SPLASH_HARD_MS = SPLASH_MAX_MS + WAIT_MS + 10000

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
  const maybeHide = () => { if (appReady && updateDone) setTimer(hide, splashDelay(now(), reduce)) }
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
export const BAR_RATE = 4 // доля отставания в секунду
export const BAR_MIN_SPEED = 15
export function barStep(shown, target, dtMs) {
  if (!(target > shown)) return target
  const dt = Math.max(0, Math.min(dtMs, 100)) / 1000
  return Math.min(target, shown + Math.max((target - shown) * BAR_RATE, BAR_MIN_SPEED) * dt)
}

// reduce — «уменьшить движение»: полоска сразу на месте. raf — кадры (тест подставляет свои).
export function splashUpdateUi(doc, root, { reduce = false, raf } = {}) {
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
  const paint = () => { fill.style.width = `${Math.round(shown * 10) / 10}%` }
  const tick = (t) => {
    shown = barStep(shown, target, last ? t - last : 16)
    last = t
    paint()
    if (shown < target) frame(tick)
    else { ticking = false; last = 0 }
  }
  const moveTo = (pct) => {
    target = Math.max(target, pct)
    if (reduce || !frame) { shown = target; paint(); return }
    if (!ticking) { ticking = true; frame(tick) }
  }
  return {
    start(version) {
      root.removeAttribute('aria-hidden') // статус должен услышать и скринридер
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
      moveTo(p.pct)
      bar.setAttribute('aria-valuenow', String(p.pct))
      // Подпись по центру не дергается при «3» → «13» (20.10.2026) и не стоит с дырой «Загружено   8»
      // (fb_afd6d919: рамка в ch была шире цифры): ширину держит невидимая копия финальной строки
      // «Загружено M из M», живая строка — от ее левого края.
      const ghost = doc.createElement('span')
      ghost.className = 'splash-upd-ghost'
      ghost.setAttribute('aria-hidden', 'true')
      ghost.textContent = `Загружено ${p.total} из ${p.total}`
      const live = doc.createElement('span')
      live.className = 'splash-upd-live'
      live.textContent = `Загружено ${p.done} из ${p.total}`
      const capBox = doc.createElement('span')
      capBox.className = 'splash-upd-capbox'
      capBox.append(ghost, live)
      cap.replaceChildren(capBox)
    },
    installing() {
      bar.classList.remove('splash-upd-bar--busy')
      moveTo(100)
      bar.setAttribute('aria-valuenow', '100')
      cap.textContent = 'Устанавливаем…'
    },
    fallback() {
      box.classList.add('splash-upd--note')
      title.textContent = 'Связь слабая'
      cap.textContent = 'Открываем текущую версию — обновление докачается само.'
    },
  }
}
