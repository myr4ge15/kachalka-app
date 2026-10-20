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
  try { check = Promise.resolve(runUpdate(splashUpdateUi(doc, splash))) } catch { check = Promise.resolve('skip') }
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
export function splashUpdateUi(doc, root) {
  const box = doc?.getElementById('splash-upd')
  const title = doc?.getElementById('splash-upd-title')
  const bar = doc?.getElementById('splash-upd-bar')
  const fill = doc?.getElementById('splash-upd-fill')
  const cap = doc?.getElementById('splash-upd-cap')
  if (!box || !title || !bar || !fill || !cap) return {}
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
      fill.style.width = `${p.pct}%`
      bar.setAttribute('aria-valuenow', String(p.pct))
      // Число загруженных — в рамке ширины общего числа (20.10.2026): строка по центру, и с ростом
      // «3» → «13» вся подпись дергалась вбок. Теперь меняются только цифры внутри рамки.
      const done = doc.createElement('span')
      done.className = 'splash-upd-n'
      done.style.minWidth = `${String(p.total).length}ch`
      done.textContent = String(p.done)
      cap.replaceChildren('Загружено ', done, ` из ${p.total}`)
    },
    installing() {
      bar.classList.remove('splash-upd-bar--busy')
      fill.style.width = '100%'
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
