import { test, expect } from '@playwright/test'
import { enterPin, tabbar } from './helpers.js'

test('итоги месяца скрыты до первой записи и работают офлайн после сохранения', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window.navigator, 'onLine', { get: () => false, configurable: true })
  })
  await context.route(/supabase\.co/, (route) => route.abort())
  await page.goto('/kachalka-app/')
  const user = await page.evaluate(async () => (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E())
  await page.reload()
  await page.getByRole('button', { name: user.name }).click()
  await enterPin(page, user.pin)
  await expect(tabbar(page)).toBeVisible()
  await expect(page.getByRole('button', { name: /итоги в цифрах/ })).toHaveCount(0)
  await page.evaluate(async (userId) => {
    const [{ saveWorkout }, { E2E_EXERCISES }] = await Promise.all([
      import('/kachalka-app/src/db/repo.js'), import('/kachalka-app/src/test/e2eSeed.js'),
    ])
    const now = new Date()
    await saveWorkout({ user_id: userId, performed_at: new Date(now.getFullYear(), now.getMonth() - 1, 15, 12).toISOString(), entries: [{ exercise: E2E_EXERCISES[0], sets: [{ weight: 60, reps: 5 }] }] })
  }, user.id)
  await page.getByRole('button', { name: /итоги в цифрах/ }).click()
  const summary = page.getByRole('region', { name: 'Итоги месяца' })
  await expect(summary).toBeVisible()
  await expect(summary.getByText('Рабочие подходы')).toBeVisible()
  await summary.getByRole('button', { name: 'Посмотреть тренировки месяца' }).click()
  await expect(summary.getByText(/Жим лежа \(e2e\):/)).toBeVisible()
  await expect(summary.getByText('Личные рекорды', { exact: false })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/monthly-summary.png', fullPage: true })
  await summary.getByRole('button', { name: 'Следующий месяц' }).click()
  await expect(summary.getByText(/Месяц еще идет/)).toBeVisible()
  await expect(summary.getByText('За этот месяц пока нет тренировок.')).toBeVisible()
})
