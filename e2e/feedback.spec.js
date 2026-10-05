import { test, expect } from '@playwright/test'

test('участник открывает «Написать разработчику» из Настроек, офлайн видит пояснение', async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }))
  await context.route(/supabase\.co/, route => route.abort())
  await page.goto('/kachalka-app/')
  const user = await page.evaluate(async () => (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E())
  await page.reload()
  await page.getByRole('button', { name: user.name }).click()
  for (const digit of user.pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${digit}$`) }).click()
  await page.getByRole('button', { name: 'Открыть профиль' }).click()
  await page.getByRole('button', { name: /Настройки/ }).first().click()
  await page.getByRole('button', { name: /Написать разработчику/ }).click()
  await expect(page.getByRole('heading', { name: 'Обратная связь' })).toBeVisible()
  await page.getByLabel('Что случилось?').fill('Не открывается прогресс')
  await expect(page.getByText('Нет связи. Отправить можно будет онлайн.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Отправить' })).toBeDisabled()
  await page.setViewportSize({ width: 320, height: 740 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  // «Назад» возвращает в Настройки (как у других экранов оттуда).
  await page.getByRole('button', { name: /Назад/ }).first().click()
  await expect(page.getByRole('button', { name: /Написать разработчику/ })).toBeVisible()
})
