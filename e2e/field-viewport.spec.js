import { expect, test } from '@playwright/test'
import { pickerItem, seedAndLogin, tabbar } from './helpers.js'

test.use({ hasTouch: true, reducedMotion: 'reduce' })

for (const [width, height, short] of [[320, 568, 330], [740, 360, 205]]) {
  test(`при вводе на ${width}×${height} поля и результат поиска доступны над клавиатурой`, async ({ page, context }) => {
    const full = { width, height }
    await page.setViewportSize(full)
    await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }))
    await context.route(/supabase\.co/, (route) => route.abort())
    await seedAndLogin(page)
    const enter = async (field) => {
      await field.tap()
      await expect(field).toBeFocused()
      await page.setViewportSize({ width, height: short })
      await expect.poll(() => field.evaluate((input) => {
        const box = input.getBoundingClientRect()
        const center = box.left + box.width / 2
        return [box.top + 1, box.bottom - 1].every((height) => document.elementFromPoint(center, height) === input)
      })).toBe(true)
    }
    await page.getByRole('button', { name: 'Открыть профиль', exact: true }).first().click()
    await page.getByRole('button', { name: /Вес и замеры/ }).click()
    await page.getByRole('button', { name: /Записать вес/ }).click()
    await enter(page.getByLabel('Заметка', { exact: true }))
    await page.setViewportSize(full)
    await page.getByRole('button', { name: 'отмена', exact: true }).click()
    await tabbar(page).getByRole('button', { name: 'Записать тренировку' }).click()
    await page.getByRole('button', { name: 'Добавить упражнение' }).click()
    const search = page.getByRole('textbox', { name: 'Поиск упражнения' })
    await enter(search)
    await search.fill('Жим лежа')
    const result = pickerItem(page, 'Жим лежа (e2e)').first()
    await expect(result).toBeInViewport({ ratio: 1 })
    await result.tap()
    await expect(search).toHaveCount(0)
    await page.setViewportSize(full)
    const weight = page.getByLabel('Вес, подход 1', { exact: true })
    await enter(weight)
    await weight.fill('65'); await expect(weight).toHaveValue('65')
  })
}
