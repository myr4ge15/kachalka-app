import { expect, test } from '@playwright/test'
import { pickerItem, saveButton, seedAndLogin } from './helpers.js'

test('смена единицы сохраняет рекомендацию и снимает рамку после касания', async ({ context, page }, testInfo) => {
  await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }))
  await context.route(/supabase\.co/, route => route.abort())
  const user = await seedAndLogin(page)
  await page.evaluate(async id => {
    const { writeDraft } = await import('/kachalka-app/src/lib/draftStore.js')
    const sets = [{ weight: 50, reps: 10, _k: 'first' }]
    writeDraft('workout_draft_new_' + id, [{
      exercise: { id: 'test-pulldown', name: 'Тяга верхнего блока', metric: 'weight' }, sets,
      prog: { prev: [{ weight: 47.5, reps: 10 }], recSets: sets, whenIso: new Date().toISOString(),
        kind: 'up', reason: 'Все повторы выполнены · +2.5 кг', applied: true },
    }])
  }, user.id)
  await page.getByRole('button', { name: 'Записать тренировку' }).click()
  const units = page.getByRole('combobox', { name: 'Единица нагрузки' })
  const recommendation = page.locator('.ap-rec')
  for (const [unit, text] of [['lb', '110.2 lb'], ['block', '50×10'], ['kg', '50×10']]) {
    await units.dispatchEvent('pointerdown', { pointerType: 'touch' })
    await units.focus()
    await units.selectOption(unit)
    await expect(recommendation).toContainText(text)
    await expect(page.locator('.load-unit')).toHaveCSS('outline-style', 'none')
    if (unit === 'lb') await page.screenshot({ path: testInfo.outputPath('recommendation-lb.png') })
  }
})

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
  const units = page.getByRole('combobox', { name: 'Единица нагрузки' })
  await expect(units).toHaveValue('kg')
  await units.selectOption('block')
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
  await expect(units).toHaveValue('block')
  await expect(page.getByLabel('Номер блока, подход 1', { exact: true })).toHaveValue('7')
  await expect(page.getByText('Номер блока 7 × 12', { exact: true }).first()).toBeVisible()
})
