// ============================================================================
// Геометрия кнопок на главных экранах (аудит 16.10, 🟡-1). Кнопки «съезжали» раз за разом
// (вылезали за край, соседние разной высоты) и правились по одной после жалоб. Этот тест
// ловит такое сам: на каждом экране — e2e/helpers.js layoutProblems.
// Вход и сеть — как в smoke.spec.js: офлайн, сид src/test/e2eSeed.js.
// ============================================================================
import { test, expect } from '@playwright/test'
import { enterPin, tabbar, openTab, pickerItem, layoutProblems, seedAndLogin, switchableOnline } from './helpers.js'

const APP = '/kachalka-app/'
const EXERCISE = 'Жим лежа (e2e)'

test('офлайн-план на телефоне открывается из истории и начинает отдельную тренировку', async ({ page, context }) => {
  await switchableOnline(context)
  await seedAndLogin(page)
  await openTab(page, 'Тренировки')
  await page.getByRole('button', { name: 'Запланировать тренировку' }).click()
  await page.getByRole('button', { name: 'Добавить упражнения' }).click()
  await page.getByRole('checkbox', { name: EXERCISE }).check()
  await page.getByRole('button', { name: 'Добавить · 1' }).click()
  const plan = page.getByRole('dialog', { name: 'Запланировать тренировку' })
  await expect(plan.getByRole('button', { name: 'Начать' })).toBeInViewport()
  await plan.getByRole('button', { name: 'Начать' }).click()
  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()
  await expect(page.getByText(EXERCISE, { exact: true })).toBeVisible()
})

test('строки плана на телефоне оставляют место названию и кнопке удаления', async ({ page, context }) => {
  await switchableOnline(context)
  const user = await seedAndLogin(page)
  await page.evaluate(async id => {
    const { writeDraft } = await import('/kachalka-app/src/lib/draftStore.js')
    const names = ['Жим лежа на наклонной скамье', 'Жим лежа со штангой', 'Молотковые сгибания', 'Жим Арнольда', 'Шраги со штангой стоя']
    const plan = names.map((name, i) => ({ id: 'plan-' + i, name, metric: 'weight' }))
    const { db } = await import('/kachalka-app/src/db/local.js')
    await db.exercises.bulkPut(plan)
    const { toggleFavorite } = await import('/kachalka-app/src/db/repo.js')
    await toggleFavorite(id, plan[3].id)
    writeDraft('workout_plan_' + id, plan)
    writeDraft('workout_draft_new_' + id, [{ exercise: plan[0], sets: [{ weight: 30, reps: 8 }] }])
  }, user.id)
  await openTab(page, 'Тренировки')
  await page.getByRole('button', { name: /Запланировать тренировку/ }).click()
  const plan = page.getByRole('dialog', { name: 'Запланировать тренировку' })
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 740, height: 360 }]) {
    await page.setViewportSize(size)
    const rows = plan.getByRole('listitem')
    await expect(rows).toHaveCount(5)
    await expect(plan.getByRole('button', { name: /^Как выполнять/ })).toHaveCount(0)
    for (const row of await rows.all()) {
      const bounds = await row.boundingBox()
      const remove = await row.getByRole('button', { name: /Убрать/ }).boundingBox()
      expect(remove.width).toBe(44)
      expect(remove.height).toBe(44)
      expect(Math.abs((remove.y - bounds.y) - (bounds.height - remove.height) / 2)).toBeLessThanOrEqual(1)
    }
    await expect(plan.getByRole('button', { name: /Вернуться/ })).toBeInViewport({ ratio: 1 })
    if (size.width === 390) {
      const add = await plan.getByRole('button', { name: 'Добавить упражнения' }).boundingBox()
      const last = await rows.last().boundingBox()
      expect(add.y - last.y - last.height).toBeGreaterThanOrEqual(8)
      await page.screenshot({ path: 'work/next-plan-mobile.png' })
    }
  }
  await page.setViewportSize({ width: 320, height: 568 })
  await plan.getByRole('button', { name: 'Добавить упражнения' }).click()
  const picker = page.getByRole('dialog', { name: 'Упражнения для плана' })
  const name = 'Жим лежа на наклонной скамье'
  const checkbox = picker.getByRole('checkbox', { name, exact: true })
  await expect(picker.locator('.picker-star:not(.on)')).toHaveCount(0)
  const star = picker.getByRole('img', { name: 'В избранном', exact: true }).first()
  await star.click()
  await expect(picker.getByRole('checkbox', { checked: true })).toHaveCount(0)
  await expect(picker.getByRole('button', { name: /В избранное|Убрать из избранного/ })).toHaveCount(0)
  const info = picker.getByRole('button', { name: 'Как выполнять: ' + name })
  const tail = info.locator('..')
  await expect(tail).toHaveText('скамье')
  const placement = await tail.evaluate(el => {
    const word = document.createRange()
    word.selectNodeContents(el.firstChild)
    const text = word.getBoundingClientRect()
    const icon = el.querySelector('svg').getBoundingClientRect()
    return icon.left >= text.right && icon.top < text.bottom && icon.bottom > text.top
  })
  expect(placement).toBe(true)
  await info.click()
  await page.getByRole('dialog', { name, exact: true }).getByRole('button', { name: 'закрыть' }).click()
  await expect(checkbox).not.toBeChecked()
  const startOfName = await info.locator('..').locator('..').evaluate(el => {
    const range = document.createRange()
    range.setStart(el.firstChild, 0)
    range.setEnd(el.firstChild, 3)
    const box = range.getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  })
  await page.mouse.click(startOfName.x, startOfName.y)
  await expect(checkbox).toBeChecked()
  await page.screenshot({ path: 'work/fb_ae00bf41-picker.png' })
})

test('крупное фото вмещается лёжа, закрывается тапом и не отдаёт фокус профилю', async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 360 })
  await page.route(/supabase\.co/, (route) => route.abort())
  await page.goto(APP)
  await page.evaluate(async () => {
    const { default: React } = await import('/kachalka-app/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/kachalka-app/node_modules/.vite/deps/react-dom_client.js')
    const { default: AvatarZoom } = await import('/kachalka-app/src/components/ui/AvatarZoom.jsx')
    const host = document.createElement('div')
    document.getElementById('root').style.display = 'none'
    document.body.append(host)
    ReactDOM.createRoot(host).render(React.createElement(AvatarZoom, { name: 'Маша', url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }))
  })
  const open = page.getByRole('button', { name: /открыть крупно/ })
  await open.click()
  const photo = page.getByRole('dialog', { name: 'Аватар Маша' })
  await expect(photo.locator('img')).toBeInViewport({ ratio: 1 })
  await expect(photo.getByText('Маша')).toBeInViewport({ ratio: 1 })
  expect(await photo.evaluate((dialog) => { document.querySelector('.avatar-zoom-btn').focus(); return dialog.contains(document.activeElement) })).toBe(true)
  await photo.locator('img').click()
  await expect(open).toBeFocused()
  await open.click()
  await page.keyboard.press('Escape')
  await expect(photo).toHaveCount(0)
})

test('занятый тумблер остаётся видимым, задержка показа действует на скелетон', async ({ page }) => {
  await page.setContent(`
    <button class="act menu-row push-toggle" role="switch" aria-checked="false">Присылать на это устройство</button>
    <div class="skel-cards skel-delay" aria-busy="true">Загрузка</div>
  `)
  await page.addStyleTag({ path: 'src/index.css' })
  const toggle = page.getByRole('switch')
  await toggle.evaluate((element) => element.setAttribute('aria-busy', 'true'))
  await expect(toggle).toHaveCSS('animation-name', 'none')
  await expect(toggle).toHaveCSS('opacity', '1')
  await expect(page.locator('.skel-delay')).toHaveCSS('animation-name', 'skel-appear')
})

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
    const row = page.getByRole('article', { name: 'Александр с длинным именем' })
    expect((await row.boundingBox()).height).toBeLessThan(120)
    await expect(page.getByRole('region', { name: 'Подробности: Александр с длинным именем' })).toHaveCount(0)
    await page.screenshot({ path: `test-results/domain-migration-${width}.png`, fullPage: true })
    await row.getByRole('button').click()
    await expect(page.getByRole('region', { name: 'Подробности: Александр с длинным именем' })).toBeVisible()
    await expectTidy(page, 'Подробности переезда')
    await page.screenshot({ path: `test-results/domain-migration-details-${width}.png`, fullPage: true })
    await row.getByRole('button').click()
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

  await page.evaluate(async (userId) => {
    const { E2E_EXERCISES } = await import('/kachalka-app/src/test/e2eSeed.js')
    const { openUserDb } = await import('/kachalka-app/src/db/local.js')
    const { saveWorkout } = await import('/kachalka-app/src/db/repo.js')
    await openUserDb(userId)
    for (const [age, weight] of [[35, 50], [5, 65]]) {
      const day = new Date()
      day.setDate(day.getDate() - age)
      await saveWorkout({ user_id: userId, performed_at: day.toISOString(), entries: [
        { exercise: E2E_EXERCISES[0], sets: [{ weight, reps: 8 }] },
        { exercise: { ...E2E_EXERCISES[1], name: 'Подтягивания широким хватом в гравитроне' }, sets: [{ weight: 0, reps: age === 35 ? 8 : 10 }] },
      ] })
    }
  }, user.id)

  await expectTidy(page, 'вход')
  await page.getByRole('button', { name: user.name }).click()
  await enterPin(page, user.pin)
  await expect(tabbar(page)).toBeVisible()

  await expectTidy(page, 'Главная')
  await page.getByText('Подробнее', { exact: true }).first().click()
  const volume = page.getByRole('region', { name: 'Объем по группам' })
  const chest = volume.getByRole('button', { name: /^Грудь/ })
  await chest.click()
  await expect(chest).toHaveAttribute('aria-expanded', 'true')
  await expect(volume.getByText('Середина груди', { exact: true })).toBeVisible()
  await expectTidy(page, 'объём по отдельным мышцам')
  await page.getByRole('button', { name: /Назад/ }).first().click()
  const progress = page.getByRole('button', { name: /Прогресс в 2 из 2 упр\./ })
  await progress.click()
  await expect(page.getByRole('cell', { name: '50 кг', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '65 кг', exact: true })).toBeVisible()
  const resultEdges = await page.locator('.home-exercise-progress-table strong').evaluateAll((results) =>
    results.map((result) => Math.round(result.getBoundingClientRect().right)))
  expect(resultEdges).toHaveLength(2)
  expect(resultEdges[0]).toBe(resultEdges[1])
  await expectTidy(page, 'Прогресс на Главной')
  await page.getByRole('button', { name: EXERCISE, exact: true }).click()
  await expect(page.locator('.prog-select')).toHaveValue('e2e-ex-bench')

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
