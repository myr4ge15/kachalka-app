// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { supabase, hasSession } from './supabase.js'
import { checkDomainMigration } from './domainMigration.js'
import { reportMigrationCheck, touchDomainMigration, fetchDomainMigrationStatus } from './domainMigrationStatus.js'

vi.mock('./supabase.js', () => ({ supabase: { rpc: vi.fn() }, hasSession: vi.fn() }))
vi.mock('./domainMigration.js', () => ({ checkDomainMigration: vi.fn() }))
vi.mock('../lib/appVersion.js', () => ({ APP_VERSION: '1.10.0', IS_BETA: false }))
beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'myr4ge15.github.io', pathname: '/kachalka-app/' } })
  hasSession.mockResolvedValue(true)
  supabase.rpc.mockResolvedValue({ data: [], error: null })
  checkDomainMigration.mockResolvedValue('ready')
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('передает контракт RPC, стабильный id браузера и проверяет свою сессию', async () => {
  await reportMigrationCheck('u', 'ready')
  const args = supabase.rpc.mock.calls[0][1]
  expect(args).toMatchObject({ p_domain: 'old', p_version: '1.10.0', p_save_state: 'ready', p_device_label: 'Браузер' })
  expect(args.p_device_id).toMatch(/^[0-9a-f-]{36}$/)
  await reportMigrationCheck('u', 'draft')
  expect(supabase.rpc.mock.calls[1][1].p_device_id).toBe(args.p_device_id)
  expect(hasSession).toHaveBeenCalledWith('u')
})
it('при возвращении сначала снимает старое подтверждение, затем проверяет данные', async () => {
  await touchDomainMigration('u')
  expect(checkDomainMigration).toHaveBeenCalledWith('u')
  expect(supabase.rpc.mock.calls.map((c) => c[1].p_save_state)).toEqual(['unknown', 'ready'])
})
it.each(['draft', 'pending', 'sync', 'offline'])('передает неуспешный результат %s', async (state) => {
  checkDomainMigration.mockResolvedValue(state)
  await touchDomainMigration('u')
  expect(supabase.rpc.mock.lastCall[1].p_save_state).toBe(state)
})
it('ошибка чтения не становится подтверждением; смена учетки оставляет unknown', async () => {
  checkDomainMigration.mockRejectedValue(new Error('read'))
  await touchDomainMigration('u')
  expect(supabase.rpc.mock.lastCall[1].p_save_state).toBe('error')
  checkDomainMigration.mockResolvedValue('account')
  await touchDomainMigration('u')
  expect(supabase.rpc.mock.lastCall[1].p_save_state).toBe('unknown')
})
it('новый домен отмечает активность без проверки старой базы', async () => {
  window.location.hostname = 'kachalka-app.ru'
  window.location.pathname = '/app/'
  await touchDomainMigration('u')
  expect(supabase.rpc.mock.lastCall[1]).toMatchObject({ p_domain: 'new', p_save_state: 'unknown' })
  expect(checkDomainMigration).not.toHaveBeenCalled()
})
it('офлайн, чужая сессия, неизвестный адрес и отсутствие учетки не создают отметок', async () => {
  await touchDomainMigration(null)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  await touchDomainMigration('u')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  hasSession.mockResolvedValue(false)
  await touchDomainMigration('u')
  window.location.hostname = 'localhost'
  await touchDomainMigration('u')
  expect(supabase.rpc).not.toHaveBeenCalled()
  expect(checkDomainMigration).not.toHaveBeenCalled()
})
it('два heartbeat не запускают две проверки', async () => {
  let finish
  checkDomainMigration.mockReturnValue(new Promise((r) => { finish = r }))
  const first = touchDomainMigration('u')
  await vi.waitFor(() => expect(checkDomainMigration).toHaveBeenCalledOnce())
  await touchDomainMigration('u')
  finish('ready')
  await first
  expect(checkDomainMigration).toHaveBeenCalledOnce()
})
it('сбой сети или localStorage не ломает приложение и не посылает ложное ready', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage') })
  await expect(touchDomainMigration('u')).resolves.toBeUndefined()
  expect(supabase.rpc).not.toHaveBeenCalled()
  vi.restoreAllMocks()
  supabase.rpc.mockRejectedValue(new Error('network'))
  await expect(touchDomainMigration('u')).resolves.toBeUndefined()
})
it('админская витрина: данные и явные ошибки офлайна, сессии, SQL, 2FA и сети', async () => {
  const rows = [{ user_id: 'u', name: 'Саня', devices: [] }]
  supabase.rpc.mockResolvedValue({ data: rows })
  expect(await fetchDomainMigrationStatus('u')).toEqual(rows)
  expect(supabase.rpc).toHaveBeenCalledWith('admin_domain_migration_status')
  for (const [code, message] of [['42883', 'накат SQL'], ['PGRST202', 'накат SQL'], ['42501', '2FA'], ['500', 'Не удалось']]) {
    supabase.rpc.mockResolvedValue({ error: { code } })
    await expect(fetchDomainMigrationStatus('u')).rejects.toThrow(message)
  }
  supabase.rpc.mockResolvedValue({ data: null })
  await expect(fetchDomainMigrationStatus('u')).rejects.toThrow('прочитать')
  hasSession.mockResolvedValue(false)
  await expect(fetchDomainMigrationStatus('u')).rejects.toThrow('Сессия')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  await expect(fetchDomainMigrationStatus('u')).rejects.toThrow('Нет сети')
})
it.each([['iPhone', 0, 'iPhone'], ['iPad', 0, 'iPad'], ['Macintosh', 5, 'iPad'], ['Android', 0, 'Android']])('краткая подпись устройства %s', async (ua, touches, label) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: touches })
  await reportMigrationCheck('u', 'bad-state')
  expect(supabase.rpc.mock.lastCall[1]).toMatchObject({ p_device_label: label, p_save_state: 'unknown' })
})
