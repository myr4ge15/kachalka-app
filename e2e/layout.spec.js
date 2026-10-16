// ============================================================================
// Геометрия кнопок на главных экранах (аудит 16.10, 🟡-1). Кнопки «съезжали» раз за разом
// (вылезали за край, соседние разной высоты) и правились по одной после жалоб. Этот тест
// ловит такое сам: на каждом экране — e2e/helpers.js layoutProblems.
// Вход и сеть — как в smoke.spec.js: офлайн, сид src/test/e2eSeed.js.
// ============================================================================
import { test, expect } from '@playwright/test'
import { enterPin, tabbar, openTab, pickerItem, layoutProblems } from './helpers.js'

const APP = '/kachalka-app/'
const EXERCISE = 'Жим лежа (e2e)'

async function settle(page) {
  // Экран въезжает сдвигом; меряем после анимаций.
  await page.waitForTimeout(450)
}

async function expectTidy(page, screen) {
  await settle(page)
  expect(await layoutProblems(page), `экран «${screen}»`).toEqual([])
}

test('кнопки на главных экранах не выходят за край и ровные в ряду', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window.navigator, 'onLine', { get: () => false, configurable: true })
  })
  await context.route(/supabase\.co/, (route) => route.abort())

  await page.goto(APP)
  const user = await page.evaluate(async () => {
    const seed = await import('/kachalka-app/src/test/e2eSeed.js')
    return seed.seedE2E()
  })
  await page.reload()

  await expectTidy(page, 'вход')
  await page.getByRole('button', { name: user.name }).click()
  await enterPin(page, user.pin)
  await expect(tabbar(page)).toBeVisible()

  await expectTidy(page, 'Главная')

  await openTab(page, 'Тренировки')
  await expectTidy(page, 'Тренировки')

  // exact: при пустой истории есть еще «+ Записать тренировку» пустого экрана (в CI так и было, 16.10).
  await page.getByRole('button', { name: 'Записать тренировку', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить упражнение' }).click()
  await expectTidy(page, 'пикер упражнений')
  await pickerItem(page, EXERCISE).click()
  await expectTidy(page, 'новая тренировка')

  await openTab(page, 'Лента')
  await expectTidy(page, 'Лента')

  await openTab(page, 'Прогресс')
  await expectTidy(page, 'Прогресс')

  await page.getByRole('button', { name: 'Открыть профиль' }).first().click()
  await expectTidy(page, 'Профиль')
})
