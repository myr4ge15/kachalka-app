// ============================================================================
// «Оформление» (v6): выбранный акцент живет после перезагрузки и ставится ДО отрисовки —
// public/accent-boot.js из <head> (CSP запрещает инлайн-скрипты), а не позже из React.
// Иначе первый кадр мигал бы акцентом по умолчанию (покрытие тестами 19.10.2026).
// ============================================================================
import { test, expect } from '@playwright/test'
import { seedAndLogin } from './helpers.js'

test('акцент: выбор → перезагрузка → стоит с первого кадра, у своей учетки', async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }))
  // Первое значение data-accent на <html> — кто бы его ни поставил первым. Init-скрипт
  // выполняется до разбора HTML (<html> еще нет), поэтому наблюдаем за всем документом.
  await context.addInitScript(() => {
    new MutationObserver((list, obs) => {
      for (const m of list) {
        if (m.target === document.documentElement && window.__firstAccent === undefined) {
          window.__firstAccent = document.documentElement.getAttribute('data-accent')
          obs.disconnect()
        }
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-accent'] })
  })
  await context.route(/supabase\.co/, (route) => route.abort())
  const user = await seedAndLogin(page)

  await page.getByRole('button', { name: 'Открыть профиль' }).click()
  await page.getByRole('button', { name: 'Настройки', exact: true }).click()
  await page.getByRole('button', { name: /Оформление/ }).click()
  await expect(page.getByRole('heading', { name: 'Оформление' })).toBeVisible()

  const group = page.getByRole('radiogroup', { name: 'Акцентный цвет' })
  await expect(group.getByRole('radio', { name: /Фиолет/ })).toHaveAttribute('aria-checked', 'true') // по умолчанию
  await group.getByRole('radio', { name: /Бирюза/ }).click()
  await expect(group.getByRole('radio', { name: /Бирюза/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal')
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gym_app_accent')))
  expect(stored).toMatchObject({ id: 'teal', by: user.id })

  await page.reload()
  expect(await page.evaluate(() => window.__firstAccent)).toBe('teal')
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal')
})
