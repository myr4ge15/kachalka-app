// Телефон лежа (v6.16.4): пикер упражнений открывался десктопной модалкой 80vh, и
// шапка, поиск, чипы и «+ свое» съедали ее целиком — список сжимался в ноль
// (на 852×393 — 38 px, на 740×360 — 12 px). Теперь лист во всю высоту, поиск и
// чипы — одной строкой; проверяем, что под список остается заметная высота и
// упражнение в нем видно и нажимается. Раскладку jsdom не считает — только e2e.
import { test, expect } from '@playwright/test'

test('телефон лежа: в пикере упражнений виден список', async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }))
  await context.route(/supabase\.co/, (route) => route.abort())
  await page.goto('/kachalka-app/')
  const user = await page.evaluate(async () => (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E())
  await page.reload()
  await page.getByRole('button', { name: user.name }).click()
  for (const digit of user.pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${digit}$`) }).click()
  await expect(page.locator('.tabbar')).toBeVisible()

  for (const size of [{ width: 852, height: 393 }, { width: 740, height: 360 }]) {
    await page.setViewportSize(size)
    // «+» в колонке меню слева (лежа таббар — «рельса»); на Главной есть вторая такая кнопка.
    await page.locator('.tabbar').getByRole('button', { name: 'Записать тренировку' }).click()
    await page.getByRole('button', { name: 'Добавить упражнение' }).click()
    const list = page.locator('.picker-list')
    await expect(list).toBeVisible()
    // Минимум две строки упражнений (56 px каждая) — не щель между шапкой и кнопкой.
    await expect.poll(async () => (await list.boundingBox())?.height ?? 0).toBeGreaterThan(150)
    // Лист не выходит за экран: «+ свое» внизу целиком видно.
    const add = page.getByRole('button', { name: '+ добавить свое упражнение' })
    await expect(add).toBeInViewport({ ratio: 1 })
    await list.locator('.picker-item').filter({ hasText: 'Жим лежа (e2e)' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.locator('.tabbar .tab').filter({ hasText: 'Главная' }).click()
  }
})
