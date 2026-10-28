// @vitest-environment jsdom
// Сплэш холодного старта и блок «Обновляем до v…» (lib/splashBoot.js, вынесено из main.jsx).
import { beforeEach, describe, expect, it } from 'vitest'
import { barStep, splashUpdateUi, startSplash, BAR_MIN_SPEED, BAR_PACE_SHARE, BAR_LAG_OK, BAR_HOLD_MS, INSTALL_HOLD_MS, SPLASH_HARD_MS } from './splashBoot.js'
import { SPLASH_FADE_MS, SPLASH_MAX_MS } from './splash.js'

// Та же разметка, что в index.html.
const MARKUP = `
  <div id="splash" aria-hidden="true">
    <div class="splash-upd" id="splash-upd" role="status" hidden>
      <p class="splash-upd-title" id="splash-upd-title"></p>
      <div class="splash-upd-bar" id="splash-upd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100">
        <div class="splash-upd-fill" id="splash-upd-fill"></div>
      </div>
      <p class="splash-upd-cap" id="splash-upd-cap"></p>
    </div>
  </div>`

const $ = (id) => document.getElementById(id)

// Ручные таймеры: [{ fn, ms }], запускаем явно.
function timers() {
  const list = []
  return {
    list,
    setTimer: (fn, ms) => { list.push({ fn, ms }) },
    run(ms) { for (const t of list.splice(0).filter((x) => x.ms === ms)) t.fn() },
    runAll() { let guard = 0; while (list.length && guard++ < 50) list.shift().fn() },
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => { document.body.innerHTML = MARKUP })

describe('splashUpdateUi', () => {
  it('start — «Обновляем до v…», статус слышит скринридер, полоса бежит', () => {
    const ui = splashUpdateUi(document, $('splash'))
    ui.start('1.2.0')
    expect($('splash-upd').hidden).toBe(false)
    expect($('splash').hasAttribute('aria-hidden')).toBe(false)
    expect($('splash-upd-title').textContent).toBe('Обновляем до v1.2.0')
    expect($('splash-upd-title').querySelector('.version-number').textContent).toBe('v1.2.0')
    expect($('splash-upd-cap').textContent).toBe('Загружаем…')
    expect($('splash-upd-bar').classList.contains('splash-upd-bar--busy')).toBe(true)
  })

  it('start — штанга прыгает, но только после сборки (задержка от начала загрузки)', () => {
    const ui = splashUpdateUi(document, $('splash'), { now: () => 400 })
    ui.start('1.2.0')
    expect($('splash').classList.contains('splash--updating')).toBe(true)
    expect($('splash').style.getPropertyValue('--splash-loop-delay')).toBe('850ms')
    document.body.innerHTML = MARKUP
    splashUpdateUi(document, $('splash'), { now: () => 400, reduce: true }).start('1.2.0')
    expect($('splash').style.getPropertyValue('--splash-loop-delay')).toBe('0ms')
  })

  it('progress — проценты и «Загружено N%», пустой прогресс ничего не меняет', () => {
    const ui = splashUpdateUi(document, $('splash'), { reduce: true })
    ui.start('1.2.0')
    ui.progress(null)
    expect($('splash-upd-cap').textContent).toBe('Загружаем…')
    ui.progress({ done: 3, total: 10, pct: 30 })
    expect($('splash-upd-bar').classList.contains('splash-upd-bar--busy')).toBe(false)
    expect($('splash-upd-fill').style.width).toBe('30%')
    expect($('splash-upd-bar').getAttribute('aria-valuenow')).toBe('30')
    expect($('splash-upd-cap').querySelector('.splash-upd-live').textContent).toBe('Загружено 30%')
    // ширину держит невидимая финальная строка: подпись не дергается и без дыры у цифры (fb_afd6d919)
    const ghost = $('splash-upd-cap').querySelector('.splash-upd-ghost')
    expect(ghost.textContent).toBe('Загружено 100%')
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
  })

  it('полоска догоняет загрузку по кадрам, не обгоняет и не откатывается (fb_afd6d919)', () => {
    const frames = []
    let t = 0
    const raf = (fn) => frames.push(fn)
    const run = (n) => { for (let i = 0; i < n && frames.length; i++) frames.shift()((t += 16)) }
    const w = () => parseFloat($('splash-upd-fill').style.width)
    const ui = splashUpdateUi(document, $('splash'), { raf })
    ui.start('1.2.0')
    ui.progress({ done: 5, total: 10, pct: 50 })
    expect($('splash-upd-bar').getAttribute('aria-valuenow')).toBe('50')
    run(1)
    expect(w()).toBeGreaterThan(0)
    expect(w()).toBeLessThan(50)
    run(300)
    expect(w()).toBe(50)
    expect(frames).toHaveLength(0) // дошла — кадры не крутит
    ui.progress({ done: 3, total: 10, pct: 30 }) // запоздавшее событие не откатывает
    expect(w()).toBe(50)
    ui.installing()
    run(300)
    expect(w()).toBe(100)
  })

  it('installing — обещание «на 100% и постояла»: не раньше, чем полоска дошла, и после паузы', async () => {
    const frames = []
    let t = 0
    const raf = (fn) => frames.push(fn)
    const run = (n) => { for (let i = 0; i < n && frames.length; i++) frames.shift()((t += 16)) }
    const tm = timers()
    let clock = 0
    const ui = splashUpdateUi(document, $('splash'), { raf, setTimer: tm.setTimer, now: () => clock })
    ui.start('1.2.0')
    ui.progress({ done: 1, total: 10, pct: 10 })
    clock = 10000 // медленная сеть: темп 0,5 %/с — хвост все равно не тянется секундами
    ui.progress({ done: 6, total: 10, pct: 60 })
    run(300)
    let done = false
    ui.installing().then(() => { done = true })
    run(1)
    expect(parseFloat($('splash-upd-fill').style.width)).toBeLessThan(100)
    expect(tm.list).toHaveLength(0) // не дошла — паузу не ставим
    const live = () => $('splash-upd-cap').querySelector('.splash-upd-live')?.textContent
    expect(live()).toBe('Загружено 100%') // видео 28.10: с 96% сразу «Устанавливаем…», 100% не было
    run(60) // ~1 с: хвост 60 → 100% — меньше секунды
    expect($('splash-upd-fill').style.width).toBe('100%')
    expect(tm.list.map((x) => x.ms)).toEqual([BAR_HOLD_MS])
    expect(live()).toBe('Загружено 100%')
    tm.run(BAR_HOLD_MS)
    expect($('splash-upd-cap').textContent).toBe('Устанавливаем…')
    await flush()
    expect(done).toBe(false)
    expect(tm.list.map((x) => x.ms)).toEqual([INSTALL_HOLD_MS])
    tm.run(INSTALL_HOLD_MS)
    await flush()
    expect(done).toBe(true)
  })

  it('barStep: быстро при большом отставании, не медленнее минимума у цели, без обгона', () => {
    expect(barStep(0, 100, 100)).toBeCloseTo(40)
    expect(barStep(99.9, 100, 16)).toBe(100)
    expect(barStep(90, 91, 16)).toBeCloseTo(90 + BAR_MIN_SPEED * 0.016)
    expect(barStep(50, 40, 16)).toBe(40)
    expect(barStep(0, 100, 5000)).toBeCloseTo(40) // долгий кадр (вкладка спала) — без прыжка
  })

  // fb_d4103a75: при известном темпе полоска идет ровно, а не «догнала — стоит».
  it('barStep с темпом: чуть медленнее загрузки, ускоряется только при большом отставании', () => {
    expect(barStep(50, 52, 100, 3)).toBeCloseTo(50 + 3 * BAR_PACE_SHARE * 0.1)
    expect(barStep(50, 70, 100, 3)).toBeCloseTo(50 + (20 - BAR_LAG_OK) * 4 * 0.1)
    expect(barStep(50, 50, 100, 3)).toBe(50)
  })

  it('темп загрузки (fb_d4103a75): после второго файла полоска идет ровно, а не скачком к цели', () => {
    const frames = []
    const raf = (fn) => frames.push(fn)
    let t = 0
    let clock = 0
    const run = (n) => { for (let i = 0; i < n && frames.length; i++) frames.shift()((t += 16)) }
    const w = () => parseFloat($('splash-upd-fill').style.width)
    const ui = splashUpdateUi(document, $('splash'), { raf, now: () => clock })
    ui.start('1.2.0')
    ui.progress({ done: 1, total: 10, pct: 10 })
    run(300)
    clock = 2000 // 10 % за 2 с → темп 5 %/с
    ui.progress({ done: 2, total: 10, pct: 20 })
    const from = w()
    run(62) // ~1 с
    expect(w() - from).toBeGreaterThan(3)
    expect(w() - from).toBeLessThan(6) // не догнала 20 % рывком — идет темпом загрузки
  })

  it('installing — «Загружено 100%», потом «Устанавливаем…»; fallback — «Связь слабая»', () => {
    const tm = timers()
    const ui = splashUpdateUi(document, $('splash'), { reduce: true, setTimer: tm.setTimer })
    ui.start('1.2.0')
    ui.installing()
    expect($('splash-upd-fill').style.width).toBe('100%')
    expect($('splash-upd-cap').querySelector('.splash-upd-live').textContent).toBe('Загружено 100%')
    tm.run(BAR_HOLD_MS)
    expect($('splash-upd-cap').textContent).toBe('Устанавливаем…')
    ui.fallback()
    expect($('splash-upd').classList.contains('splash-upd--note')).toBe(true)
    expect($('splash-upd-title').textContent).toBe('Связь слабая')
    expect($('splash-upd-cap').textContent).toMatch(/Открываем текущую версию/)
  })

  it('старый index.html без блока — пустой ui, ничего не падает', () => {
    document.body.innerHTML = '<div id="splash"></div>'
    expect(splashUpdateUi(document, $('splash'))).toEqual({})
  })
})

describe('startSplash', () => {
  function boot({ result = 'none', reduce = false, elapsed = 5000 } = {}) {
    const t = timers()
    let ready = null
    let resolveUpdate
    const update = new Promise((r) => { resolveUpdate = r })
    const seenUi = []
    startSplash({
      splash: $('splash'),
      reduce,
      onReady: (fn) => { ready = fn },
      runUpdate: (ui) => { seenUi.push(ui); return update },
      now: () => elapsed,
      setTimer: t.setTimer,
    })
    return { t, ready: () => ready(), finishUpdate: (r = result) => resolveUpdate(r), seenUi }
  }

  it('уходит, только когда И приложение готово, И проверка обновления закончилась', async () => {
    const b = boot()
    expect(b.seenUi[0]).toHaveProperty('start') // ui сплэша передан в проверку обновления
    b.ready()
    expect(b.t.list.map((x) => x.ms)).toEqual([SPLASH_HARD_MS]) // готово, но обновление идет — держим
    b.finishUpdate('none')
    await flush()
    // анимация уже доиграла (elapsed > минимума) — снимаем сразу; плюс потолок от конца проверки
    expect(b.t.list.map((x) => x.ms).sort((a, z) => a - z)).toEqual([0, SPLASH_MAX_MS, SPLASH_HARD_MS])
    b.t.run(0)
    expect($('splash').classList.contains('splash--out')).toBe(true)
    b.t.run(SPLASH_FADE_MS)
    expect($('splash')).toBeNull()
  })

  it('проверка закончилась раньше готовности — ждем App', async () => {
    const b = boot()
    b.finishUpdate('fallback')
    await flush()
    expect(b.t.list.some((x) => x.ms === 0)).toBe(false)
    b.ready()
    b.t.run(0)
    expect($('splash').classList.contains('splash--out')).toBe(true)
  })

  it('applied — страница перезагружается, сплэш не снимаем (кроме страховки)', async () => {
    const b = boot()
    b.ready()
    b.finishUpdate('applied')
    await flush()
    expect(b.t.list.map((x) => x.ms)).toEqual([SPLASH_HARD_MS])
    expect($('splash').classList.contains('splash--out')).toBe(false)
  })

  it('проверка упала — как «нечего обновлять», сплэш уходит', async () => {
    const t = timers()
    startSplash({
      splash: $('splash'),
      onReady: (fn) => fn(),
      runUpdate: () => { throw new Error('boom') },
      now: () => 5000,
      setTimer: t.setTimer,
    })
    await flush()
    t.run(0)
    expect($('splash').classList.contains('splash--out')).toBe(true)
  })

  it('«уменьшить движение» — без ожидания анимации и без затухания; повторное снятие не дублирует', async () => {
    const b = boot({ reduce: true, elapsed: 0 })
    b.ready()
    b.finishUpdate('none')
    await flush()
    b.t.run(0) // splashDelay при reduce = 0 → hide → удаление тоже через 0
    expect($('splash').classList.contains('splash--out')).toBe(true)
    b.t.runAll() // потолки тоже срабатывают — второй раз hide ничего не делает
    expect($('splash')).toBeNull()
  })

  it('страница без #splash — ничего не делаем', () => {
    document.body.innerHTML = ''
    const t = timers()
    startSplash({ splash: null, onReady: () => {}, runUpdate: () => 'none', setTimer: t.setTimer })
    expect(t.list).toEqual([])
  })
})
