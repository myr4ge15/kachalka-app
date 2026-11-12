import { test, expect } from '@playwright/test'
import { enterPin, openTab, pickerItem, tabbar } from './helpers.js'

const DEV = 'http://127.0.0.1:5174/kachalka-app/'
const APP = 'http://127.0.0.1:5175/kachalka-app/'
const EXERCISE = 'Жим лежа (e2e)'

test.use({
  storageState: async ({ browser }, use) => {
    const seed = await browser.newContext()
    try {
      await seed.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }))
      const page = await seed.newPage()
      await page.goto(DEV)
      await page.evaluate(async () => (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E())
      const state = await seed.storageState({ indexedDB: true })
      state.origins.find((item) => item.origin === new URL(DEV).origin).origin = new URL(APP).origin
      await use(state)
    } finally {
      await seed.close()
    }
  },
})

test('обновление service worker на собранной PWA сохраняет офлайн-черновик', async ({ page, context, request }) => {
  await context.route(/supabase\.co/, (route) => route.abort())
  const version = (await (await request.get(`${APP}version.json`)).json()).version
  await page.goto(APP)
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)

  await context.setOffline(true)
  await page.getByRole('button', { name: 'E2E Тестер' }).click()
  await enterPin(page, '1234')
  await expect(tabbar(page)).toBeVisible()
  await openTab(page, 'Тренировки')
  const workout = page.getByRole('button', { name: 'Записать тренировку', exact: true })
  await workout.click()
  await page.getByRole('button', { name: 'Добавить упражнение' }).click()
  await pickerItem(page, EXERCISE).click()
  const inputs = page.locator('.exercise-card--active .set-row input')
  await inputs.first().fill('62.5')
  await inputs.nth(1).fill('8')

  const deployed = await request.post(new URL('/deploy-update', APP).href)
  expect(deployed.ok()).toBe(true)
  const next = (await (await request.get(`${APP}version.json`)).json()).version
  expect(next).not.toBe(version)
  await context.setOffline(false)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(inputs.first()).toHaveValue('62.5')

  // Уходим из композера с черновиком и разрешаем штатное обновление при возврате.
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(workout).toBeVisible()
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  const profile = page.getByRole('button', { name: 'Открыть профиль', exact: true })
  const installed = page.locator('.version-number')
  // Обновление перезагружает документ. Читаем sessionStorage после появления
  // новой версии, внутри проверки, которая повторяется при смене контекста.
  await expect(async () => {
    if (!await installed.isVisible()) await profile.click({ timeout: 1500 })
    await expect(installed).toHaveText(`v${next}`, { timeout: 1500 })
    expect(await page.evaluate(() => sessionStorage.getItem('gym_app_update_resume'))).toBe(next)
  }).toPass({ timeout: 30_000 })
  await openTab(page, 'Тренировки')
  await workout.click()
  await expect(page.locator('.exercise-card--active')).toContainText(EXERCISE)
  await expect(inputs.first()).toHaveValue('62.5')
  await expect(inputs.nth(1)).toHaveValue('8')
})
