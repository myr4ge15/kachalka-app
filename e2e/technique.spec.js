import { test, expect } from '@playwright/test'
import { enterPin } from './helpers.js'

// Подсказка «Как выполнять» (v8.0.0): открывается из карточки и из пикера, ничего
// не меняет в тренировке, закрывается без потери введенного и места в пикере.
test('подсказка по технике: карточка и пикер, данные тренировки не меняются', async ({ page, context }) => {
  await context.route(/supabase\.co/, route => route.abort())
  await page.goto('/kachalka-app/')
  const user = await page.evaluate(async () => {
    const seed = await import('/kachalka-app/src/test/e2eSeed.js')
    const bench = {
      id: 'e2e-ex-tech-bench', name: 'Жим лежа со штангой', muscle_group: 'грудь',
      submuscle: 'chest_middle', secondary: ['triceps'], metric: 'weight', is_custom: false, is_hidden: false,
    }
    const u = await seed.seedE2E({ exercises: [...seed.E2E_EXERCISES, bench] })
    const { writeDraft } = await import('/kachalka-app/src/lib/draftStore.js')
    writeDraft(`workout_draft_new_${u.id}`, [{ exercise: bench, sets: [{ weight: 62.5, reps: 7, _k: 's1' }] }])
    return u
  })
  await page.reload()
  await page.getByRole('button', { name: user.name }).click()
  await enterPin(page, user.pin)
  await page.getByRole('button', { name: 'Записать тренировку' }).click()

  // Из карточки: лист с текстом и кадром; Escape закрывает, значения на месте.
  const info = page.getByRole('button', { name: 'Как выполнять: Жим лежа со штангой' })
  await info.click()
  const sheet = page.getByRole('dialog', { name: 'Жим лежа со штангой' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Частые ошибки' })).toBeVisible()
  const frame = sheet.locator('img.is-on')
  await expect(frame).toBeVisible()
  await expect.poll(() => frame.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(page.getByLabel('Вес, подход 1')).toHaveValue('62.5')
  await expect(page.getByLabel('Повторения, подход 1')).toHaveValue('7')
  await expect(info).toBeFocused()

  // Из пикера: «i» не добавляет упражнение, после закрытия пикер с тем же поиском.
  await page.getByRole('button', { name: 'Добавить упражнение' }).click()
  const picker = page.getByRole('dialog', { name: 'Упражнение' })
  await picker.getByPlaceholder('Поиск по названию…').fill('жим лежа')
  await picker.getByRole('button', { name: 'Как выполнять: Жим лежа со штангой' }).click()
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'закрыть' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(picker).toBeVisible()
  await expect(picker.getByPlaceholder('Поиск по названию…')).toHaveValue('жим лежа')
  await picker.getByRole('button', { name: 'закрыть' }).click()
  await expect(page.locator('.exercise-card')).toHaveCount(1)
})
