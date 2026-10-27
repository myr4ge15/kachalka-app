// ============================================================================
// «Вес и замеры» (PLAN-body-metrics.md, этап 1): ввод → перезагрузка → график.
// Запись живет в персональной meta (род body), переживает перезагрузку, вход — только
// строка в Профиле. Офлайн: сервер не нужен, синк копит правку.
// ============================================================================
import { test, expect } from '@playwright/test'
import { seedAndLogin } from './helpers.js'

const ymd = (shift) => {
  const d = new Date()
  d.setDate(d.getDate() + shift)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function openBody(page) {
  await page.getByRole('button', { name: 'Открыть профиль' }).click()
  await page.getByRole('button', { name: /Вес и замеры/ }).click()
  await expect(page.getByRole('heading', { name: 'Вес и замеры' })).toBeVisible()
}

async function addWeight(page, weight, date) {
  await page.getByRole('button', { name: /Записать вес/ }).click()
  const dlg = page.getByRole('dialog')
  if (date) await dlg.getByLabel('Дата записи').fill(date)
  await dlg.getByLabel('Вес, кг').fill(weight)
  await dlg.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dlg).toBeHidden()
}

test('вес: две записи → перезагрузка → последняя сверху и график', async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }))
  await context.route(/supabase\.co/, (route) => route.abort())
  await seedAndLogin(page)

  await openBody(page)
  await expect(page.getByText('Записей пока нет')).toBeVisible()
  await addWeight(page, '82.6', ymd(-3))
  await addWeight(page, '82,3')
  await expect(page.locator('.body-now-v')).toHaveText('82.3 кг')

  await page.reload()
  await page.getByRole('navigation', { name: 'Разделы' }).waitFor()
  await openBody(page)
  await expect(page.locator('.body-now-v')).toHaveText('82.3 кг')
  await expect(page.getByRole('img', { name: 'График веса за период' })).toBeVisible()

  // «Скрыть цифры» — вес пропадает с экрана, график остается без оси.
  await page.getByRole('button', { name: 'Скрыть цифры' }).click()
  await expect(page.locator('.body-now-v')).toHaveText('•••')
  await expect(page.getByRole('img', { name: /без цифр/ })).toBeVisible()
  await expect(page.getByText('82.3 кг')).toHaveCount(0)
})
