// П7 (v6.18.0): «Удалить аккаунт» в Настройках — панель с предупреждением, PIN, бэкапом;
// офлайн удалить нельзя (учетка и данные на месте). Сеть к supabase.co режется.
import { test, expect } from '@playwright/test'

test('Настройки → «Удалить аккаунт»: офлайн — понятный отказ, ничего не стерто', async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }))
  await context.route(/supabase\.co/, (route) => route.abort())
  await page.goto('/kachalka-app/')
  const user = await page.evaluate(async () => (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E())
  await page.reload()
  await page.getByRole('button', { name: user.name }).click()
  for (const digit of user.pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${digit}$`) }).click()
  await page.getByRole('button', { name: 'Открыть профиль' }).click()
  await page.getByRole('button', { name: /Настройки/ }).first().click()
  await page.getByRole('button', { name: /Удалить аккаунт/ }).click()
  await expect(page.getByText(/удалится насовсем/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Сначала скачать мои данные/ })).toBeVisible()
  await page.getByLabel('PIN для подтверждения').fill(user.pin)
  await page.getByRole('button', { name: 'Удалить навсегда' }).click()
  await expect(page.getByRole('alert')).toContainText('только онлайн')
  await page.setViewportSize({ width: 320, height: 740 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.locator('.danger-confirm').screenshot({ path: 'test-results/delete-account.png' })
})
