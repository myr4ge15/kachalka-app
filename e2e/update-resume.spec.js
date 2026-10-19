// ============================================================================
// Возврат в приложение при новой версии на сервере (UpdatePrompt → lib/launchUpdate.js
// reloadForUpdatePush, resume). Так нажатие на пуш «Вышла версия» у свернутой PWA на
// iPhone ведет на сплэш обновления, хотя само нажатие приложение не видит (19.10.2026).
//
// Service worker здесь не нужен: ветка возврата смотрит только version.json и
// sessionStorage. В dev-сервере version.json нет (его выпускает сборка) — подменяем.
// Сплэш «Обновляем до v…» после перезагрузки требует SW и проверяется юнитами
// (lib/splashBoot.test.js, lib/launchUpdate.test.js); здесь — что перезагрузка
// случается ровно тогда, когда должна.
// ============================================================================
import { test, expect } from '@playwright/test'
import { seedAndLogin, setOnline, switchableOnline } from './helpers.js'

// Вернуться в приложение: visibilitychange при видимой вкладке (lib/appEvents.js onResume).
async function comeBack(page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
}
// Метка в window переживает все, кроме перезагрузки страницы.
const mark = (page) => page.evaluate(() => { window.__e2eMark = 1 })
const reloaded = (page) => page.evaluate(() => window.__e2eMark !== 1)

async function setup(page, context, serverVersion) {
  await switchableOnline(context)
  await context.route(/supabase\.co/, (route) => route.abort())
  await context.route('**/version.json', (route) => {
    const v = serverVersion()
    return v ? route.fulfill({ json: { version: v } }) : route.fulfill({ status: 404, body: '' })
  })
  return seedAndLogin(page)
}

const currentVersion = (page) =>
  page.evaluate(async () => (await import('/kachalka-app/src/lib/appVersion.js')).APP_VERSION)

test('новая версия на сервере — возврат перезагружает приложение, второй раз за сессию — нет', async ({ page, context }) => {
  let server = null
  await setup(page, context, () => server)
  server = '99.0.0'

  await setOnline(page, true, { fire: false })
  await mark(page)
  const load = page.waitForEvent('load')
  await comeBack(page)
  await load
  expect(await reloaded(page)).toBe(true)
  // Адрес без ?push=, флаг «уже перезагружались за эту версию» стоит.
  expect(new URL(page.url()).searchParams.has('push')).toBe(false)
  expect(await page.evaluate(() => sessionStorage.getItem('gym_app_update_resume'))).toBe('99.0.0')
  await expect(page.getByRole('navigation', { name: 'Разделы' })).toBeVisible() // сессия на месте

  // Тот же сервер, второй возврат: сплэш уже отпустил внутрь — не держим его снова.
  await setOnline(page, true, { fire: false })
  await mark(page)
  await comeBack(page)
  await page.waitForTimeout(1500)
  expect(await reloaded(page)).toBe(false)
})

test('версия та же или сервер не ответил — остаемся на месте', async ({ page, context }) => {
  let server = null
  await setup(page, context, () => server)
  await setOnline(page, true, { fire: false })

  await mark(page)
  await comeBack(page) // version.json — 404
  await page.waitForTimeout(1500)
  expect(await reloaded(page)).toBe(false)

  server = await currentVersion(page)
  await comeBack(page)
  await page.waitForTimeout(1500)
  expect(await reloaded(page)).toBe(false)
})

test('посреди записи тренировки возврат не перезагружает — черновик цел', async ({ page, context }) => {
  let server = null
  await setup(page, context, () => server)
  server = '99.0.0'

  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Тренировки', exact: true }).click()
  await page.getByRole('button', { name: 'Записать тренировку', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.composer)).toBe('1')

  await setOnline(page, true, { fire: false })
  await mark(page)
  await comeBack(page)
  await page.waitForTimeout(1500)
  expect(await reloaded(page)).toBe(false)
  await expect(page.getByRole('button', { name: 'Добавить упражнение' })).toBeVisible()
  // Флаг сессии не тратится: после записи тренировки возврат еще может обновить.
  expect(await page.evaluate(() => sessionStorage.getItem('gym_app_update_resume'))).toBeNull()
})
