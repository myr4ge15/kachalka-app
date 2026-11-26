import { expect, test } from '@playwright/test'
import { pickerItem, saveButton, seedAndLogin } from './helpers.js'

test('номер блока сохраняется офлайн и подставляется в следующей тренировке', async ({ context, page }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }))
  await context.route(/supabase\.co/, route => route.abort())
  await seedAndLogin(page)
  const add = async () => {
    await page.getByRole('button', { name: 'Записать тренировку' }).click()
    await page.getByRole('button', { name: 'Добавить упражнение' }).click()
    await pickerItem(page, 'Жим лежа (e2e)').click()
  }
  await add()
  await page.getByRole('button', { name: 'Единица нагрузки: кг' }).click()
  await page.getByRole('button', { name: /^Номер блока/ }).click()
  await page.getByLabel('Номер блока, подход 1', { exact: true }).fill('7')
  await page.getByLabel('Повторения, подход 1', { exact: true }).fill('12')
  await saveButton(page).click()
  const finish = page.getByRole('dialog', { name: 'Тренировка готова' })
  await expect(finish).toContainText('Все подходы записаны по номерам блоков.')
  await expect(finish.getByText('Тоннаж')).toHaveCount(0)
  await finish.getByText('Подходы по упражнениям').click()
  await expect(finish).toContainText('Номер блока 7 × 12')
  await finish.getByRole('button', { name: 'Готово' }).click()
  await add()
  await expect(page.getByLabel('Номер блока, подход 1', { exact: true })).toHaveValue('7')
  await expect(page.getByText('Номер блока 7 × 12', { exact: true }).first()).toBeVisible()
})
