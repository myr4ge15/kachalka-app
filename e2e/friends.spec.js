// «Друзья» (v8.9.0 / v9.0.0): ссылка #friend=<код> без учетки — превью «кто зовет» и форма
// регистрации (Edge invite-redeem подменен); неверный код — понятный отказ; вошедший —
// «Друзья» из Профиля, без сети плашка. Видимость «друзья видят друг друга / блок» — поведение
// базы, его держат SQL-тесты (supabase/tests/friends*.test.mjs).
import { test, expect } from '@playwright/test'
import { enterPin } from './helpers.js'

const APP = '/kachalka-app/'

function routeInvite(context) {
  return context.route(/supabase\.co/, async (route) => {
    const req = route.request()
    if (!/functions\/v1\/invite-redeem$/.test(req.url())) return route.abort()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
    const body = JSON.parse(req.postData() || '{}')
    const json = body.action === 'friend_check' && body.friend === '7F3Q9XWD'
      ? { status: 'ok', inviter_name: 'Сега' } : { status: 'invalid' }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(json) })
  })
}

test('ссылка #friend=… без учетки → «Сега зовет тебя в друзья», код стерт из адреса', async ({ page, context }) => {
  await routeInvite(context)
  await page.goto(`${APP}#friend=7f3q-9xwd`)
  await expect(page.getByText(/зовет тебя в друзья/)).toContainText('Сега зовет тебя в друзья')
  expect(page.url()).not.toContain('friend=')
  await expect(page.getByLabel('Логин (для входа)')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Зарегистрироваться' })).toBeVisible()
})

test('ссылка с неверным кодом дружбы — понятный отказ и путь к входу', async ({ page, context }) => {
  await routeInvite(context)
  await page.goto(`${APP}#friend=ZZZZ-ZZZZ`)
  await expect(page.getByRole('alert')).toContainText('Код не подходит')
  await expect(page.getByRole('button', { name: 'К входу' })).toBeVisible()
})

test('вошедший: Профиль → «Друзья»; без сети — плашка, назад — в Профиль', async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }))
  await context.route(/supabase\.co/, (route) => route.abort())
  await page.goto(APP)
  const user = await page.evaluate(async () => (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E())
  await page.reload()
  await page.getByRole('button', { name: user.name }).click()
  await enterPin(page, user.pin)
  await page.getByRole('button', { name: 'Открыть профиль' }).click()
  await page.getByRole('button', { name: /Друзья/ }).click()
  await expect(page.getByRole('heading', { name: 'Друзья' })).toBeVisible()
  await expect(page.getByText('Изменить друзей можно только с интернетом.')).toBeVisible()
  await page.getByRole('button', { name: /Назад/ }).first().click()
  await expect(page.getByRole('button', { name: /Друзья/ })).toBeVisible()
})
