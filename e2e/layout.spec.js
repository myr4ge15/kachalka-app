// ============================================================================
// Геометрия кнопок на главных экранах (аудит 16.10, 🟡-1). Кнопки «съезжали» раз за разом
// (вылезали за край, соседние разной высоты) и правились по одной после жалоб. Этот тест
// ловит такое сам: на каждом экране — e2e/helpers.js layoutProblems.
// Вход и сеть — как в smoke.spec.js: офлайн, сид src/test/e2eSeed.js.
// ============================================================================
import { test, expect } from '@playwright/test'
import { enterPin, tabbar, openTab, pickerItem, layoutProblems } from './helpers.js'

const APP = '/kachalka-app/'
const EXERCISE = 'Жим лежа (e2e)'

test('статусы переезда читаются на телефоне и десктопе, кнопка помещается', async ({ page }) => {
  await page.route('**/migration-layout', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/kachalka-app/src/index.css"></head><body><div id="root"></div></body></html>',
  }))
  await page.route('**/src/db/domainMigrationStatus.js*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `export const touchDomainMigration = async () => {};
      export const reportMigrationCheck = async () => {};
      export const fetchDomainMigrationStatus = async () => [
        {user_id:'one',name:'Александр с длинным именем',devices:[
          {domain:'new',device_id:'n',last_seen_at:'2026-11-05T09:00:00Z'},
          {domain:'old',device_id:'o',device_label:'iPhone',last_seen_at:'2026-11-04T09:00:00Z',checked_at:'2026-11-04T09:00:00Z',save_state:'ready',version:'1.10.0'},
          {domain:'old',device_id:'o2',device_label:'Браузер',last_seen_at:'2026-11-04T09:00:00Z',checked_at:'2026-11-04T09:00:00Z',save_state:'draft',version:'1.10.0'}]},
        {user_id:'two',name:'Маша',devices:[]}
      ];`,
  }))
  await page.goto(`${APP}migration-layout`)
  await page.evaluate(async () => {
    const { default: RefreshRuntime } = await import('/kachalka-app/@react-refresh')
    RefreshRuntime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (type) => type
    window.__vite_plugin_react_preamble_installed__ = true
    const { default: React } = await import('/kachalka-app/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/kachalka-app/node_modules/.vite/deps/react-dom_client.js')
    const { default: Section } = await import('/kachalka-app/src/components/admin/DomainMigrationSection.jsx')
    document.getElementById('root').style.display = 'none'
    const host = document.createElement('div')
    host.className = 'screen admin'
    document.body.append(host)
    ReactDOM.createRoot(host).render(React.createElement(React.Fragment, null,
      React.createElement('h2', { className: 'admin-title' }, 'Переезд на новый домен'),
      React.createElement(Section, { userId: 'admin', online: true }),
    ))
  })
  await expect(page.getByRole('article', { name: 'Александр с длинным именем' })).toBeVisible()
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    await expectTidy(page, 'Статусы переезда')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/domain-migration-${width}.png`, fullPage: true })
  }
})

async function settle(page) {
  // Экран въезжает сдвигом; меряем после анимаций.
  await page.waitForTimeout(450)
}

async function expectTidy(page, screen) {
  await settle(page)
  expect(await layoutProblems(page), `экран «${screen}»`).toEqual([])
}

test('кнопки на главных экранах не выходят за край и ровные в ряду', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window.navigator, 'onLine', { get: () => false, configurable: true })
  })
  await context.route(/supabase\.co/, (route) => route.abort())

  await page.goto(APP)
  const user = await page.evaluate(async () => {
    const seed = await import('/kachalka-app/src/test/e2eSeed.js')
    return seed.seedE2E()
  })
  await page.reload()

  await expectTidy(page, 'вход')
  await page.getByRole('button', { name: user.name }).click()
  await enterPin(page, user.pin)
  await expect(tabbar(page)).toBeVisible()

  await expectTidy(page, 'Главная')

  await openTab(page, 'Тренировки')
  await expectTidy(page, 'Тренировки')

  // exact: при пустой истории есть еще «+ Записать тренировку» пустого экрана (в CI так и было, 16.10).
  await page.getByRole('button', { name: 'Записать тренировку', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить упражнение' }).click()
  await expectTidy(page, 'пикер упражнений')
  await pickerItem(page, EXERCISE).click()
  await expectTidy(page, 'новая тренировка')

  await openTab(page, 'Лента')
  await expectTidy(page, 'Лента')

  await openTab(page, 'Прогресс')
  await expectTidy(page, 'Прогресс')

  await page.getByRole('button', { name: 'Открыть профиль' }).first().click()
  await expectTidy(page, 'Профиль')
})

// Вложенные экраны (покрытие тестами 19.10.2026): раньше e2e их не открывал вовсе — тест
// заодно ловит «экран не открывается». Назад — общая BackButton.
test('вложенные экраны открываются и кнопки на них ровные', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window.navigator, 'onLine', { get: () => false, configurable: true })
  })
  await context.route(/supabase\.co/, (route) => route.abort())

  await page.goto(APP)
  const user = await page.evaluate(async () => (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E())
  await page.reload()
  await page.getByRole('button', { name: user.name }).click()
  await enterPin(page, user.pin)
  await expect(tabbar(page)).toBeVisible()

  const back = () => page.getByRole('button', { name: /Назад/ }).first().click()
  const visit = async (heading) => {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await expectTidy(page, heading)
    await back()
  }

  await page.getByRole('button', { name: /^Уведомления/ }).first().click()
  await visit('Уведомления')

  // У тестовой учетки тренировок нет — «Достижения» видны и новичку (с 20.10.2026).
  await page.getByRole('button', { name: 'Открыть профиль' }).first().click()
  await page.getByRole('button', { name: /Достижения/ }).first().click()
  await visit('Достижения')

  await page.getByRole('button', { name: 'Настройки', exact: true }).click()
  for (const [button, heading] of [
    [/Оформление/, 'Оформление'],
    [/Каталог упражнений/, 'Каталог упражнений'],
    [/Что нового/, 'Обновления'],
  ]) {
    await page.getByRole('button', { name: button }).first().click()
    await visit(heading)
  }
})

test('раскрытые блоки круга отделены от заголовков', async ({ page, context }) => {
  await context.route(/supabase\.co/, (route) => route.abort())
  await page.goto(APP)
  await page.evaluate(async () => {
    const { default: React } = await import('/kachalka-app/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/kachalka-app/node_modules/.vite/deps/react-dom_client.js')
    const { default: CircleCode } = await import('/kachalka-app/src/components/circle/CircleCode.jsx')
    const { default: CircleOwnerSettings } = await import('/kachalka-app/src/components/circle/CircleOwnerSettings.jsx')
    await (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E()
    const host = document.createElement('div')
    host.className = 'screen fc-screen'
    document.getElementById('root').style.display = 'none'
    document.body.append(host)
    const api = {
      myCode: async () => ({ code: '7F3Q9XWD', uses: 0, max_uses: 10 }),
      codes: async () => [], disciplines: async () => [],
    }
    const circle = { circle_id: 'c1', name: 'Зал', members: 5 }
    ReactDOM.createRoot(host).render(React.createElement(React.Fragment, null,
      React.createElement(CircleCode, { api, circle }),
      React.createElement(CircleOwnerSettings, { api, circle }),
    ))
  })
  for (const title of ['Мой код в круг', 'Настройки круга']) {
    const button = page.getByRole('button', { name: title, exact: true })
    await button.click()
    const fold = button.locator('..')
    const card = fold.locator('.fc-fold-panel > .card')
    await expect(card).toBeVisible()
    await settle(page)
    const headerBox = await button.boundingBox()
    const cardBox = await card.boundingBox()
    expect(cardBox.y - headerBox.y - headerBox.height).toBeGreaterThanOrEqual(8)
    await expectTidy(page, title)
    await page.screenshot({ path: `test-results/circle-${title === 'Мой код в круг' ? 'code' : 'settings'}.png`, fullPage: true })
    await button.click()
    await expect(card).toBeHidden()
  }
})
