// @vitest-environment jsdom
// Сплэш холодного старта и блок «Обновляем до v…» (lib/splashBoot.js, вынесено из main.jsx).
import { beforeEach, describe, expect, it } from 'vitest'
import { splashUpdateUi, startSplash, SPLASH_HARD_MS } from './splashBoot.js'
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

  it('progress — проценты и «Загружено N из M», пустой прогресс ничего не меняет', () => {
    const ui = splashUpdateUi(document, $('splash'))
    ui.start('1.2.0')
    ui.progress(null)
    expect($('splash-upd-cap').textContent).toBe('Загружаем…')
    ui.progress({ done: 3, total: 10, pct: 30 })
    expect($('splash-upd-bar').classList.contains('splash-upd-bar--busy')).toBe(false)
    expect($('splash-upd-fill').style.width).toBe('30%')
    expect($('splash-upd-bar').getAttribute('aria-valuenow')).toBe('30')
    expect($('splash-upd-cap').textContent).toBe('Загружено 3 из 10')
    // число — в рамке ширины общего: подпись по центру не дергается при «3» → «13» (20.10.2026)
    expect($('splash-upd-cap').querySelector('.splash-upd-n').style.minWidth).toBe('2ch')
  })

  it('installing — 100% и «Устанавливаем…»; fallback — «Связь слабая»', () => {
    const ui = splashUpdateUi(document, $('splash'))
    ui.start('1.2.0')
    ui.installing()
    expect($('splash-upd-fill').style.width).toBe('100%')
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
