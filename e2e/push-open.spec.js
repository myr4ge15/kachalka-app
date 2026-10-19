// ============================================================================
// Нажатие на пуш (lib/pushIntent.js, hooks/useAppNav.js): service worker открывает
// приложение с `?push=<tag>`. Намерение ждет входа и применяется один раз. Сам Web Push
// Playwright не эмулирует — его держат юниты (pushIntent, pushSw); здесь — что адрес
// из пуша приводит на нужный экран (покрытие тестами 19.10.2026).
// ============================================================================
import { test, expect } from '@playwright/test'
import { enterPin, tabbar } from './helpers.js'

const APP = '/kachalka-app/'

async function openFromPush(page, context, tag) {
  await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }))
  await context.route(/supabase\.co/, (route) => route.abort())
  await page.goto(APP)
  const user = await page.evaluate(async () => (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E())
  await page.goto(`${APP}?push=${tag}`)
  await page.getByRole('button', { name: user.name }).click()
  await enterPin(page, user.pin)
  await expect(tabbar(page)).toBeVisible()
}

test('пуш «Друзья» после входа открывает экран «Друзья»', async ({ page, context }) => {
  await openFromPush(page, context, 'friend')
  await expect(page.getByRole('heading', { name: 'Друзья' })).toBeVisible()
})

test('пуш «Отдых закончился» ведет к новой тренировке', async ({ page, context }) => {
  await openFromPush(page, context, 'rest')
  await expect(page.getByRole('button', { name: 'Добавить упражнение' })).toBeVisible()
})

test('незнакомый tag — обычная Главная, без падения', async ({ page, context }) => {
  await openFromPush(page, context, 'record-whatever')
  await expect(page.getByRole('heading', { name: 'Друзья' })).toHaveCount(0)
  await expect(tabbar(page).locator('.tab.active')).toContainText('Главная')
})
