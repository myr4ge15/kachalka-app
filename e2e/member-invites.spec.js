import { test, expect } from '@playwright/test'

test('обычный участник открывает приглашения в профиле, офлайн видит пояснение', async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }))
  await context.route(/supabase\.co/, route => route.abort())
  await page.goto('/kachalka-app/')
  const user = await page.evaluate(async () => (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E())
  await page.reload()
  await page.getByRole('button', { name: user.name }).click()
  for (const digit of user.pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${digit}$`) }).click()
  await page.getByRole('button', { name: 'Открыть профиль' }).click()
  await expect(page.getByRole('button', { name: 'Админка', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Пригласить участника' }).click()
  await expect(page.getByText('Для приглашения участника нужен интернет.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Создать ссылку' })).toBeDisabled()
  await page.setViewportSize({ width: 320, height: 740 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/member-invites.png' })
})
