// ============================================================================
// Скриншоты для README (docs/screenshots/*.png) одной командой:
//
//   npm run shots:readme            — все 11 экранов
//   npm run shots:readme -- feed run — только перечисленные
//
// Что делает: поднимает vite dev-сервер (с фиктивными ключами Supabase, как e2e),
// раскладывает тестовые данные — «Андрей» и друзья, ~10 недель тренировок, лента,
// рейтинг, цель — и снимает экраны в мобильном вьюпорте 393×769 при DPR 2
// (786×1538 — README показывает их шириной 320, на ретине этого хватает).
// Если в PATH есть pngquant — дожимает PNG (~80 КБ на экран вместо ~300 КБ).
//
// Сеть не нужна: navigator.onLine = false, запросы к supabase.co режутся. Чтобы
// шапка выглядела как у живого приложения в сети, ТОЛЬКО на время съемки
// подменяются два места в отдаваемых dev-сервером модулях: статус синка
// (зеленая галочка вместо облака «нет сети») и подпись рейтинга («Обновлено»
// вместо «Без сети · сохранено»). Код приложения не меняется. Если подмена не
// нашла свою строку (код переписали) — скрипт падает с понятной ошибкой.
//
// Аватарки — эмодзи-звери на градиенте, рисуются canvas'ом в самой странице
// (шрифт эмодзи системный: на Windows и Linux звери чуть разные — это нормально).
// Даты тренировок отсчитываются от «сейчас», поэтому на скриншотах всегда свежие.
//
// Браузер — тот же, что у e2e (`npx playwright install chromium`); другой
// бинарник можно указать в PW_CHROMIUM.
// ============================================================================
// Часть функций выполняется В СТРАНИЦЕ (page.evaluate / addInitScript) — там есть DOM.
/* global document */ // localStorage — уже глобал в globals.node (ESLint 10 / globals 17)
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'docs', 'screenshots')
const VIEWPORT = { width: 393, height: 769 }
const SCALE = 2
const ACCENT = { id: 'custom', hue: 205 } // бирюзовый, как на прежних скриншотах
const ALL = ['home', 'recovery', 'workout', 'progress-overview', 'progress-chart',
  'feed', 'rating', 'run', 'achievements', 'login', 'join-pending']
const only = process.argv.slice(2)
for (const n of only) if (!ALL.includes(n)) throw new Error(`Неизвестный экран «${n}». Есть: ${ALL.join(', ')}`)
const want = (n) => only.length === 0 || only.includes(n)

// ---------- тестовые данные -------------------------------------------------
const USER = { id: 'demo', name: 'Андрей', pin: '1234' }
const FRIENDS = [
  { id: 'f1', name: 'Борис' }, { id: 'f2', name: 'Сергей' },
  { id: 'f3', name: 'Аня' }, { id: 'f4', name: 'Макс' },
]
const AVATARS = {
  demo: ['🦁', '#F59E0B', '#B45309'], f1: ['🐻', '#8B5CF6', '#5B21B6'],
  f2: ['🐺', '#3B82F6', '#1E40AF'], f3: ['🦊', '#EC4899', '#9D174D'], f4: ['🐯', '#10B981', '#047857'],
}
const ex = (id, name, muscle_group, submuscle, secondary, metric, is_bench_lift = false) =>
  ({ id, name, muscle_group, submuscle, secondary, metric, is_bench_lift, is_hidden: false })
const EXERCISES = [
  ex('bench', 'Жим лёжа со штангой', 'грудь', 'chest_middle', ['triceps', 'delt_front'], 'weight', true),
  ex('incline', 'Жим гантелей на наклонной', 'грудь', 'chest_upper', ['delt_front', 'triceps'], 'weight'),
  ex('squat', 'Приседания со штангой', 'ноги', 'quads', ['glute_max'], 'weight'),
  ex('legpress', 'Жим ногами', 'ноги', 'quads', ['glute_max'], 'weight'),
  ex('row', 'Тяга штанги в наклоне', 'спина', 'lats', ['biceps'], 'weight'),
  ex('pullups', 'Подтягивания', 'спина', 'lats', ['biceps'], 'reps'),
  ex('press', 'Жим штанги стоя', 'плечи', 'delt_front', ['triceps'], 'weight'),
  ex('curl', 'Подъём штанги на бицепс', 'руки', 'biceps', [], 'weight'),
  ex('plank', 'Планка', 'пресс', 'abs_rectus', [], 'time'),
  ex('run', 'Бег', 'кардио', 'cardio', [], 'distance'),
]

// Выполняется В СТРАНИЦЕ (модули приложения грузятся у vite dev-сервера).
async function seedData({ uid, EXERCISES, FRIENDS, AVATARS, ACCENT }) {
  const { saveWorkout, setAccentPref, cacheUsers } = await import('/kachalka-app/src/db/repo.js')
  const L = await import('/kachalka-app/src/db/local.js')
  const N = await import('/kachalka-app/src/db/notifications.js')
  const { rowToItem, computePrs } = await import('/kachalka-app/src/db/feed.js')
  const { disciplineSignature } = await import('/kachalka-app/src/lib/disciplines.js')
  const E = Object.fromEntries(EXERCISES.map((e) => [e.id, e]))
  const day = 864e5
  const now = Date.now()
  const at = (daysAgo, h = 19) => { const d = new Date(now - daysAgo * day); d.setHours(h, 10, 0, 0); return d.toISOString() }

  const avatar = ([emoji, c1, c2]) => {
    const S = 256
    const c = document.createElement('canvas'); c.width = S; c.height = S
    const g = c.getContext('2d')
    const grad = g.createLinearGradient(0, 0, 0, S); grad.addColorStop(0, c1); grad.addColorStop(1, c2)
    g.fillStyle = grad; g.fillRect(0, 0, S, S)
    g.font = '150px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(emoji, S / 2, S / 2 + 10)
    return c.toDataURL('image/png')
  }

  // Свои тренировки: ~10 недель, через 2–3 дня, три чередующихся сплита.
  // Жим растет 85 → 105 с провалом посередине (на графике видны и рост, и спад).
  const benchW = [85, 87.5, 87.5, 90, 92.5, 92.5, 95, 97.5, 97.5, 100, 100, 97.5, 92.5, 95, 97.5, 100, 102.5, 102.5, 105, 105]
  const plan = []
  for (let d = 68; d >= 2; d -= 2.3) plan.push(Math.round(d))
  for (let i = 0; i < plan.length; i++) {
    const type = i % 3
    const step = Math.floor(i / 3)
    const wB = benchW[Math.min(benchW.length - 1, Math.floor((i * benchW.length) / plan.length))]
    let entries
    if (type === 0) entries = [
      { exercise: E.bench, sets: [{ weight: wB, reps: 8 }, { weight: wB, reps: 8 }, { weight: wB, reps: 6 }] },
      { exercise: E.pullups, sets: [{ weight: 0, reps: 8 + Math.floor(step / 3) }, { weight: 0, reps: 7 + Math.floor(step / 3) }] },
      { exercise: E.plank, sets: [{ weight: 0, reps: 60 + step * 6 }] },
    ]
    else if (type === 1) entries = [
      { exercise: E.squat, sets: [{ weight: 70 + step * 2.5, reps: 6 }, { weight: 70 + step * 2.5, reps: 6 }, { weight: 70 + step * 2.5, reps: 5 }] },
      { exercise: E.row, sets: [{ weight: 50 + Math.floor(step / 2) * 2.5, reps: 10 }, { weight: 50 + Math.floor(step / 2) * 2.5, reps: 10 }] },
      { exercise: E.run, sets: [{ weight: 3 + (step % 3), reps: Math.round((3 + (step % 3)) * (345 - step * 2)) }] },
    ]
    else entries = [
      { exercise: E.press, sets: [{ weight: 35 + Math.floor(step / 2) * 2.5, reps: 8 }, { weight: 35 + Math.floor(step / 2) * 2.5, reps: 7 }] },
      { exercise: E.incline, sets: [{ weight: 20 + Math.floor(step / 3) * 2, reps: 10 }, { weight: 20 + Math.floor(step / 3) * 2, reps: 10 }] },
      { exercise: E.curl, sets: [{ weight: 25 + Math.floor(step / 3) * 2.5, reps: 10 }, { weight: 25 + Math.floor(step / 3) * 2.5, reps: 9 }] },
    ]
    await saveWorkout({ user_id: uid, performed_at: at(plan[i]), entries })
  }

  await setAccentPref(uid, ACCENT)
  await N.writeGoals(uid, [{ exerciseId: 'bench', exerciseName: E.bench.name, metric: 'weight',
    targetWeight: 110, targetReps: 1, achievedAt: null, _dirty: 0 }])
  await cacheUsers([
    { id: uid, name: 'Андрей', sort_order: 1, avatar_url: avatar(AVATARS[uid]) },
    ...FRIENDS.map((f, i) => ({ ...f, sort_order: i + 2, avatar_url: avatar(AVATARS[f.id]) })),
  ])

  // Лента: строки в серверном формате → те же rowToItem/computePrs, что у fetchFeed.
  let wid = 0
  const W = (u, name, daysAgo, h, list) => ({
    id: 'fw' + (++wid), performed_at: at(daysAgo, h), user_id: u, user: { id: u, name },
    workout_exercises: list.map(([e, sets], p) => ({
      id: `we${wid}_${p}`, position: p, exercise_id: e, exercise: E[e],
      sets: sets.map(([w, r], n) => ({ id: `s${wid}_${p}_${n}`, set_number: n + 1, weight: w, reps: r })),
    })),
  })
  const rows = [
    W('f2', 'Сергей', 0.2, 8, [['bench', [[90, 5], [90, 4], [85, 5]]], ['pullups', [[0, 15], [0, 12]]], ['plank', [[0, 150]]]]),
    W('f3', 'Аня', 0.9, 20, [['squat', [[50, 8], [50, 8], [50, 7]]], ['run', [[5, 1650]]]]),
    W(uid, 'Андрей', 2, 19, [['squat', [[92.5, 6], [92.5, 6]]], ['row', [[62.5, 10], [62.5, 10]]], ['run', [[5, 1590]]]]),
    W('f1', 'Борис', 2.3, 18, [['bench', [[100, 3], [95, 4]]], ['press', [[55, 6], [55, 5]]], ['curl', [[40, 8], [40, 8]]]]),
    W('f4', 'Макс', 3, 7, [['legpress', [[160, 12], [180, 10], [180, 10]]], ['row', [[60, 10], [60, 10]]]]),
    W('f2', 'Сергей', 4, 9, [['squat', [[110, 5], [110, 5]]], ['run', [[6, 2050]]]]),
    W('f3', 'Аня', 5, 20, [['bench', [[42.5, 6], [42.5, 6]]], ['plank', [[0, 170]]]]),
    W('f1', 'Борис', 8, 18, [['bench', [[97.5, 3], [95, 3]]], ['pullups', [[0, 9], [0, 8]]]]),
    W('f2', 'Сергей', 9, 9, [['bench', [[87.5, 5], [85, 5]]], ['pullups', [[0, 14], [0, 12]]], ['plank', [[0, 140]]]]),
    W('f3', 'Аня', 11, 20, [['squat', [[47.5, 8], [47.5, 8]]], ['run', [[4, 1380]]]]),
  ]
  const items = rows.map(rowToItem)
  computePrs(items)
  const R = (u, name, kind) => ({ user_id: u, name, kind, created_at: new Date().toISOString() })
  items[0].reactions = [R('f1', 'Борис', 'fire'), R(uid, 'Андрей', 'muscle'), R('f3', 'Аня', 'fire')]
  items[1].reactions = [R('f2', 'Сергей', 'clap')]
  items[2].reactions = [R('f1', 'Борис', 'muscle'), R('f3', 'Аня', 'muscle')]
  items[3].reactions = [R('f2', 'Сергей', 'wow'), R(uid, 'Андрей', 'fire')]
  const db = await L.openUserDb(uid)
  await db.feed.clear()
  await db.feed.bulkPut(items)

  // Рейтинг: снимки дисциплин в meta, как их кладет db/disciplines.js.
  const catalog = [
    { id: 'bench', exercise_id: 'bench', name: 'Жим лёжа', metric: 'weight', split_by_sex: false, updated_at: '2026-10-02' },
    { id: 'pullups', exercise_id: 'pullups', name: 'Подтягивания', metric: 'reps', split_by_sex: false, updated_at: '2026-10-02' },
    { id: 'plank', exercise_id: 'plank', name: 'Планка', metric: 'time', split_by_sex: false, updated_at: '2026-10-02' },
  ]
  const fetchedAt = new Date().toISOString()
  await L.setMeta('rating_catalog', { items: catalog, fetchedAt })
  const P = (id, name) => ({ user_id: id, user_name: name, board: 'all' })
  const boards = [
    [{ ...P(uid, 'Андрей'), weight: 105, reps: 8, value: 105, orm: 133 },
      { ...P('f1', 'Борис'), weight: 100, reps: 3, value: 100, orm: 110 },
      { ...P('f2', 'Сергей'), weight: 90, reps: 5, value: 90, orm: 105 },
      { ...P('f4', 'Макс'), weight: 72.5, reps: 8, value: 72.5, orm: 91.8 },
      { ...P('f3', 'Аня'), weight: 42.5, reps: 6, value: 42.5, orm: 51 }],
    [{ ...P('f2', 'Сергей'), weight: 0, reps: 15, value: 15 },
      { ...P(uid, 'Андрей'), weight: 0, reps: 13, value: 13 },
      { ...P('f1', 'Борис'), weight: 0, reps: 9, value: 9 }],
    [{ ...P('f3', 'Аня'), weight: 0, reps: 170, value: 170 },
      { ...P('f2', 'Сергей'), weight: 0, reps: 150, value: 150 },
      { ...P(uid, 'Андрей'), weight: 0, reps: 126, value: 126 }],
  ]
  for (let i = 0; i < catalog.length; i++) {
    await L.setMeta(`rating_board_${catalog[i].id}`, {
      signature: disciplineSignature(catalog[i]), fetchedAt,
      rows: boards[i].map((r) => ({ ...r, metric: catalog[i].metric, performed_at: at(2) })),
    })
  }

  // Чистая шапка: колокольчик прочитан, очередей синка нет.
  await N.markAllSeen(uid, await N.getNotifications(uid))
  for (const t of db.tables) if (t.name.endsWith('outbox')) await t.clear()
  await db.workouts.toCollection().modify({ _dirty: 0 })
}

// ---------- подмены «как в сети» (только для съемки) ------------------------
const PATCHES = [
  { url: /\/src\/db\/sync\.js(\?|$)/, find: /online: navigator\.onLine,/, put: 'online: true,', what: 'статус синка' },
  { url: /\/src\/screens\/DisciplineLeaderboard\.jsx(\?|$)/, find: /navigator\.onLine \? "Обновлено"/, put: 'true ? "Обновлено"', what: 'подпись рейтинга' },
]

const patchMisses = new Set()

async function newContext(browser) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, locale: 'ru-RU', timezoneId: 'Europe/Moscow' })
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }))
  await ctx.addInitScript((a) => { try { localStorage.setItem('gym_app_accent', JSON.stringify(a)) } catch { /* приватный режим */ } }, ACCENT)
  await ctx.route(/supabase\.co/, (r) => r.abort())
  for (const p of PATCHES) {
    await ctx.route(p.url, async (route) => {
      const res = await route.fetch()
      const body = await res.text()
      if (!p.find.test(body)) patchMisses.add(p.what) // отдаем как есть, упадем после съемки
      await route.fulfill({ response: res, body: body.replace(p.find, p.put) })
    })
  }
  return ctx
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  process.env.VITE_SUPABASE_URL = 'https://e2e-offline.supabase.co'
  process.env.VITE_SUPABASE_KEY = 'sb_publishable_e2e_offline'
  const server = await createServer({ root: ROOT, logLevel: 'warn', server: { host: '127.0.0.1', port: 5175 } })
  await server.listen()
  const base = server.resolvedUrls.local[0]
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
  const saved = []
  try {
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    const shot = async (name) => {
      if (!want(name)) return
      await page.waitForTimeout(1000)
      await page.screenshot({ path: path.join(OUT, `${name}.png`) })
      saved.push(name)
      console.log(`  ✓ ${name}.png`)
    }
    const login = async () => {
      await page.getByRole('button', { name: USER.name }).click()
      for (const d of USER.pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${d}$`) }).click()
      await page.locator('.tabbar').waitFor()
    }
    const reopen = async () => {
      await page.goto(base)
      await page.locator('.tabbar').waitFor({ timeout: 4000 }).catch(login)
      await page.waitForTimeout(800)
    }
    const tab = (t) => page.locator('.tabbar .tab').filter({ hasText: t }).click()

    console.log('Раскладываю тестовые данные…')
    await page.goto(base)
    await page.evaluate(async (u) => (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E(u), {
      user: USER, exercises: EXERCISES,
    })
    await page.reload()
    await login()
    await page.evaluate(seedData, { uid: USER.id, EXERCISES, FRIENDS, AVATARS, ACCENT })
    await reopen()

    console.log(`Снимаю в ${path.relative(ROOT, OUT)}:`)
    await shot('home')

    if (want('recovery')) {
      await page.getByText('Подробнее ›').first().click()
      await shot('recovery')
      await tab('Главная')
    }

    if (want('workout')) {
      await page.getByRole('button', { name: 'Записать тренировку' }).click()
      await page.getByRole('button', { name: 'Добавить упражнение' }).click()
      await page.locator('.picker-item').filter({ hasText: 'Жим лёжа со штангой' }).click()
      await page.waitForTimeout(900)
      // Экран с самого верха: шапка не наезжает на заголовок, «Сохранить» закрывает «Как пошло?».
      await page.evaluate(() => document.querySelectorAll('.content').forEach((e) => { e.scrollTop = 0 }))
      await shot('workout')
      await reopen()
    }

    if (want('progress-overview') || want('progress-chart')) {
      await tab('Прогресс')
      await shot('progress-overview')
      await page.evaluate(() => document.querySelector('.recharts-wrapper')?.scrollIntoView({ block: 'start' }))
      await page.mouse.wheel(0, -60)
      await shot('progress-chart')
    }

    if (want('feed') || want('rating')) {
      await tab('Лента')
      await page.waitForTimeout(500)
      // Раскрытие рейтинга запоминается — для ленты сворачиваем.
      if (await page.getByRole('button', { name: 'Жим лёжа', exact: true }).isVisible().catch(() => false)) {
        await page.getByRole('button', { name: 'Рейтинг', exact: true }).click()
      }
      if (want('feed')) {
        await page.evaluate(() => document.querySelector('.feed-card,.feed-item,article')?.scrollIntoView({ block: 'start' }))
        await page.mouse.wheel(0, -90)
        await shot('feed')
      }
      if (want('rating')) {
        await page.getByRole('button', { name: 'Рейтинг', exact: true }).click()
        await page.waitForTimeout(400)
        await page.evaluate(() => document.querySelector('.lb-row')?.closest('section,div')?.scrollIntoView({ block: 'center' }))
        await shot('rating')
      }
    }

    if (want('run')) {
      await tab('Тренировки')
      await page.waitForTimeout(500)
      await page.locator(':has(> .history-head)').filter({ hasText: 'Бег' }).first().locator('.history-head').click()
      await page.waitForTimeout(600)
      await page.locator('.exercise-card').filter({ hasText: 'Бег' }).first().click()
      await page.locator('.exercise-card--active').first().evaluate((e) => e.scrollIntoView({ block: 'center' }))
      await shot('run')
    }

    if (want('achievements')) {
      await page.getByRole('button', { name: 'Открыть профиль' }).click()
      await page.locator('.leader-link').filter({ hasText: 'Достижения' }).click()
      await shot('achievements')
    }

    if (want('login')) {
      // Новый телефон: чистое устройство, вход по имени и PIN.
      const c2 = await newContext(browser)
      const p2 = await c2.newPage()
      await p2.goto(base)
      await p2.waitForTimeout(3500)
      await p2.screenshot({ path: path.join(OUT, 'login.png') })
      saved.push('login')
      console.log('  ✓ login.png')
    }

    if (want('join-pending')) {
      // Заявка «Запросить приглашение» отправлена и ждет ответа владельца (v6.16.0).
      // Сеть режется — автопроверка молча ждет, карточка стоит как у живого человека.
      const c3 = await newContext(browser)
      await c3.addInitScript((p) => { try { localStorage.setItem('gym_app_join_request', JSON.stringify(p)) } catch { /* приватный режим */ } },
        { id: 'demo-join', secret: 'demo-secret', name: 'Андрей' })
      const p3 = await c3.newPage()
      await p3.goto(base)
      await p3.locator('.join-status').waitFor()
      await p3.waitForTimeout(3000)
      await p3.screenshot({ path: path.join(OUT, 'join-pending.png') })
      saved.push('join-pending')
      console.log('  ✓ join-pending.png')
    }
  } finally {
    await browser.close()
    await server.close()
  }

  if (patchMisses.size) {
    throw new Error(`Подмена не нашла строку (${[...patchMisses].join(', ')}) — код изменился, ` +
      'поправь PATCHES в scripts/readme-shots.mjs. На снятых экранах будет «нет сети».')
  }

  const files = saved.map((n) => path.join(OUT, `${n}.png`))
  const pq = spawnSync('pngquant', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' })
  if (pq.status === 0 && files.length) {
    const r = spawnSync('pngquant', ['--quality=80-95', '--speed', '1', '--force', '--ext', '.png', ...files],
      { stdio: 'inherit', shell: process.platform === 'win32' })
    console.log(r.status === 0 ? 'PNG дожаты pngquant.' : 'pngquant завершился с ошибкой — PNG оставлены как есть.')
  } else {
    console.log('pngquant не найден — PNG без дожатия (~300 КБ на экран). Windows: winget install pngquant')
  }
  console.log(`Готово: ${saved.length} из ${only.length || ALL.length}.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
