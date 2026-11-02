import { test, expect } from '@playwright/test'

test('инструкция переезда прокручивается, кнопки доступны на небольшом телефоне', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  // Старый origin нужен для реального условия показа. Все его запросы
  // обслуживает локальный Vite: тест не обращается в GitHub и не трогает прод.
  await page.route('https://myr4ge15.github.io/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/kachalka-app/') {
      const response = await route.fetch({ url: 'http://127.0.0.1:5174/kachalka-app/e2e/domain-migration.html' })
      await route.fulfill({ response })
    } else {
      const response = await route.fetch({ url: `http://127.0.0.1:5174${url.pathname}${url.search}` })
      await route.fulfill({ response })
    }
  })
  await page.goto('https://myr4ge15.github.io/kachalka-app/')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const button = page.getByRole('button', { name: 'Проверить данные и перейти' })
  const box = await button.boundingBox()
  expect(box.height).toBeGreaterThanOrEqual(44)
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(360)
  expect(box.y + box.height).toBeLessThanOrEqual(640)
  await expect(dialog.locator('.sheet-scroll')).toHaveCSS('overflow-y', 'auto')
  await button.click()
  await expect(dialog.getByRole('alert')).toContainText('Учетка изменилась')
  await expect(page).toHaveURL('https://myr4ge15.github.io/kachalka-app/')
  await page.screenshot({ path: 'test-results/domain-migration.png' })
  await page.getByRole('button', { name: 'Позже' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Как перейти' })).toBeVisible()
})
