// ============================================================================
// Синк с сервером в браузере (покрытие тестами 19.10.2026). Юниты держат стадии
// push/pull по отдельности; здесь — связка с настоящей Dexie: тренировка, записанная
// офлайн, после появления сети уходит `upsert_workout` с правильным телом, и с нее
// снимается `_dirty`. Сбой сервера (5xx) — не ошибка данных: операция остается в
// очереди без dead-letter (lib/syncErrors.js).
//
// Сервер — подмена PostgREST через route: своя сессия Supabase лежит в localStorage
// (claim app_metadata.app_user_id = учетка сида), `app_uid` отвечает ею же, прочие
// выборки — пустые, список id тренировок — то, что успели отправить (иначе сверка
// удалений сочла бы отправленное удаленным на сервере).
// ============================================================================
import { test, expect } from '@playwright/test'
import { CORS, fulfillJson, seedAndLogin, setOnline, switchableOnline } from './helpers.js'

const APP = '/kachalka-app/'
const USER_ID = 'e2e-user' // = E2E_USER.id в src/test/e2eSeed.js
const STORAGE_KEY = 'sb-e2e-offline-auth-token' // supabase-js: sb-<поддомен VITE_SUPABASE_URL>-auth-token

// Сессия Supabase, как ее кладет auth-login: подпись не проверяется на клиенте.
function fakeSession() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + 365 * 24 * 3600
  const user = {
    id: '00000000-0000-4000-8000-00000000e2e0', aud: 'authenticated', role: 'authenticated',
    app_metadata: { app_user_id: USER_ID }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
  }
  const access = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', exp, app_metadata: user.app_metadata })}.e2e`
  return { access_token: access, refresh_token: 'e2e-refresh', token_type: 'bearer', expires_in: 365 * 24 * 3600, expires_at: exp, user }
}

// upsertStatus() — код ответа на upsert_workout. Возвращает журнал отправленного.
async function fakeServer(context, upsertStatus) {
  const sent = { upserts: [], ids: new Set() }
  await context.route(/supabase\.co/, (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: CORS })
    if (!url.pathname.startsWith('/rest/v1/')) return route.abort() // auth, functions, storage, realtime
    const rpc = url.pathname.match(/\/rpc\/([a-z_0-9]+)$/)?.[1]
    if (rpc === 'app_uid') return fulfillJson(route, USER_ID)
    if (rpc === 'my_login') return fulfillJson(route, 'e2e')
    if (rpc === 'upsert_workout') {
      const status = upsertStatus()
      // Шлюз лежит: HTML без кода Postgres — временный сбой (lib/syncErrors.js).
      if (status !== 200) return route.fulfill({ status, headers: CORS, contentType: 'text/html', body: '<html>503 Service Unavailable</html>' })
      const body = JSON.parse(req.postData() || '{}')
      sent.upserts.push(body)
      sent.ids.add(body.p_workout_id)
      return fulfillJson(route, null)
    }
    if (rpc) return fulfillJson(route, null)
    if (req.method() === 'GET' && url.pathname === '/rest/v1/workouts' && url.searchParams.get('select') === 'id') {
      return fulfillJson(route, [...sent.ids].map((id) => ({ id })))
    }
    return fulfillJson(route, [], req.method() === 'GET' ? 200 : 201)
  })
  return sent
}

async function saveOffline(page) {
  return page.evaluate(async (userId) => {
    const [{ saveWorkout }, { E2E_EXERCISES }] = await Promise.all([
      import('/kachalka-app/src/db/repo.js'),
      import('/kachalka-app/src/test/e2eSeed.js'),
    ])
    return saveWorkout({
      user_id: userId,
      performed_at: '2026-10-19T10:00:00.000Z',
      entries: [{ exercise: E2E_EXERCISES[0], exercise_id: E2E_EXERCISES[0].id, sets: [{ weight: 60, reps: 8 }, { weight: 62.5, reps: 5 }] }],
    })
  }, USER_ID)
}

const localState = (page, id) => page.evaluate(async (wid) => {
  const { db } = await import('/kachalka-app/src/db/local.js')
  const doc = await db.workouts.get(wid)
  const ops = await db.outbox.toArray()
  return { dirty: doc?._dirty ?? null, ops: ops.filter((o) => o.workoutId === wid).length }
}, id)

async function setup(page, context, upsertStatus) {
  await switchableOnline(context)
  const sent = await fakeServer(context, upsertStatus)
  const session = fakeSession()
  await context.addInitScript(([key, value]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value)
  }, [STORAGE_KEY, JSON.stringify(session)])
  await seedAndLogin(page, APP)
  return sent
}

test('записал офлайн → появилась сеть → upsert_workout с составом, _dirty снят', async ({ page, context }) => {
  const sent = await setup(page, context, () => 200)
  const id = await saveOffline(page)
  expect(await localState(page, id)).toEqual({ dirty: 1, ops: 1 })
  expect(sent.upserts).toHaveLength(0)

  await setOnline(page, true)
  await expect.poll(() => sent.upserts.length, { timeout: 15_000 }).toBeGreaterThan(0)
  expect(sent.upserts[0]).toMatchObject({
    p_workout_id: id,
    p_user_id: USER_ID,
    p_performed_at: '2026-10-19T10:00:00.000Z',
    p_entries: [{ exercise_id: 'e2e-ex-bench', sets: [{ weight: 60, reps: 8 }, { weight: 62.5, reps: 5 }] }],
  })
  await expect.poll(() => localState(page, id), { timeout: 15_000 }).toEqual({ dirty: 0, ops: 0 })
  // Сверка удалений не сочла отправленное удаленным: тренировка в Истории.
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Тренировки', exact: true }).click()
  await expect(page.getByRole('button').filter({ hasText: 'Жим лежа (e2e)' }).first()).toContainText('60×8')
})

test('сервер отвечает 503 — операция остается в очереди, правка не теряется', async ({ page, context }) => {
  let status = 503
  const sent = await setup(page, context, () => status)
  const id = await saveOffline(page)

  await setOnline(page, true)
  await page.waitForTimeout(3000)
  expect(sent.upserts).toHaveLength(0)
  expect(await localState(page, id)).toEqual({ dirty: 1, ops: 1 })
  const dead = await page.evaluate(async () => {
    const { db } = await import('/kachalka-app/src/db/local.js')
    return (await db.outbox.toArray()).filter((o) => o._dead || (o.attempts ?? 0) > 0).length
  })
  expect(dead).toBe(0)

  // Сервер ожил — следующий прогон (снова «онлайн») отправляет.
  status = 200
  await setOnline(page, true)
  await expect.poll(() => sent.upserts.length, { timeout: 15_000 }).toBeGreaterThan(0)
  await expect.poll(() => localState(page, id), { timeout: 15_000 }).toEqual({ dirty: 0, ops: 0 })
})
