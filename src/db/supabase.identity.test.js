// db/supabase.js с настроенным бэкендом (покрытие тестами 20.10.2026: было 44 % строк).
// На hasSession/serverIdentity стоит защита синка от чужой и отозванной сессии: чужой JWT
// на общем телефоне = «нет сессии», отозванная (app_uid() = NULL) — «сервер ответил: никто»,
// сеть — «неизвестно» (тогда pull не удаляет по пустоте, AGENTS.md «Пустой ответ под RLS»).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = { getSession: vi.fn() }
const rpc = vi.fn()
const createClient = vi.fn(() => ({ auth, rpc: (...a) => rpc(...a) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: (...a) => createClient(...a) }))

let mod
beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co')
  vi.stubEnv('VITE_SUPABASE_KEY', 'sb_publishable_x')
  vi.stubEnv('VITE_SUPABASE_REF', '')
  auth.getSession.mockReset()
  rpc.mockReset()
  createClient.mockClear()
  mod = await import('./supabase.js')
})
afterEach(() => vi.unstubAllEnvs())

const session = (appUserId) => ({ data: { session: { user: { app_metadata: appUserId ? { app_user_id: appUserId } : {} } } } })

describe('клиент', () => {
  it('настроен из окружения: сессия хранится и обновляется, адрес не разбирается', () => {
    expect(mod.isConfigured).toBe(true)
    const [url, key, opts] = createClient.mock.calls[0]
    expect(url).toBe('https://abc.supabase.co')
    expect(key).toBe('sb_publishable_x')
    expect(opts.auth).toMatchObject({ persistSession: true, autoRefreshToken: true, detectSessionInUrl: false })
  })
})

describe('hasSession', () => {
  it('своя сессия — да; без userId — любая', async () => {
    auth.getSession.mockResolvedValue(session('me'))
    expect(await mod.hasSession('me')).toBe(true)
    expect(await mod.hasSession()).toBe(true)
  })
  it('сессия другой учетки (общий телефон) — как нет сессии', async () => {
    auth.getSession.mockResolvedValue(session('other'))
    expect(await mod.hasSession('me')).toBe(false)
  })
  it('сессии нет или GoTrue бросил — нет', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } })
    expect(await mod.hasSession('me')).toBe(false)
    auth.getSession.mockRejectedValue(new Error('storage blocked'))
    expect(await mod.hasSession('me')).toBe(false)
  })
})

describe('serverIdentity', () => {
  it('сервер узнал — known и id строкой', async () => {
    rpc.mockResolvedValue({ data: 42, error: null })
    expect(await mod.serverIdentity()).toEqual({ known: true, id: '42' })
    expect(rpc).toHaveBeenCalledWith('app_uid')
  })
  it('сессия отозвана: app_uid() = NULL — known, id null (pull может верить пустоте только так)', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await mod.serverIdentity()).toEqual({ known: true, id: null })
  })
  it('ошибка RPC или сеть — unknown (не блокируем, но и не удаляем)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    expect(await mod.serverIdentity()).toEqual({ known: false, id: null })
    rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await mod.serverIdentity()).toEqual({ known: false, id: null })
  })
})

describe('warmup', () => {
  it('дергает app_uid и глотает любую ошибку', async () => {
    rpc.mockRejectedValue(new Error('asleep'))
    expect(() => mod.warmup()).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    expect(rpc).toHaveBeenCalledWith('app_uid')
  })
})

describe('без настройки', () => {
  it('нет .env — isConfigured false, сеть не трогаем', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_SUPABASE_URL', '')
    const m = await import('./supabase.js')
    expect(m.isConfigured).toBe(false)
    expect(await m.hasSession('me')).toBe(false)
    expect(await m.serverIdentity()).toEqual({ known: false, id: null })
    m.warmup()
    expect(rpc).not.toHaveBeenCalled()
    expect(createClient.mock.calls.at(-1)[0]).toBe('https://placeholder.supabase.co')
  })
})
