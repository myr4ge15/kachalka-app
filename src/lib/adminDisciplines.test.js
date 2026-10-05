import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminSaveDiscipline } from './adminDisciplines.js'
import { AdminError } from './admin.js'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  db: { name: 'me' },
  invalidateRatingCache: vi.fn(),
  fetchRatingCatalog: vi.fn(),
}))
vi.mock('../db/supabase.js', () => ({ supabase: { rpc: mocks.rpc } }))
// db — live binding: геттер даёт подменить «активную базу» посреди запроса.
vi.mock('../db/local.js', () => ({ get db() { return mocks.db } }))
vi.mock('../db/disciplines.js', () => ({
  invalidateRatingCache: mocks.invalidateRatingCache,
  fetchRatingCatalog: mocks.fetchRatingCatalog,
}))
vi.mock('./admin.js', () => ({ AdminError: class AdminError extends Error {} }))

describe('adminSaveDiscipline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.db = { name: 'me' }
    mocks.rpc.mockResolvedValue({ error: null })
    mocks.fetchRatingCatalog.mockResolvedValue([])
  })

  it('без упражнения — отказ без запроса', async () => {
    await expect(adminSaveDiscipline('me', {})).rejects.toThrow('Выбери упражнение')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('шлет RPC с булевыми флагами (enabled по умолчанию true) и обновляет каталог', async () => {
    const d = mocks.db
    await expect(adminSaveDiscipline('me', { exercise_id: 'ex1', split_by_sex: 1 }))
      .resolves.toEqual({ refreshed: true })
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_discipline', {
      p_exercise_id: 'ex1', p_split_by_sex: true, p_enabled: true,
    })
    expect(mocks.invalidateRatingCache).toHaveBeenCalledWith(d)
    expect(mocks.fetchRatingCatalog).toHaveBeenCalledWith('me', { force: true })
  })

  it('ошибка сервера → AdminError с текстом сервера, кэш не трогаем', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'not admin' } })
    const p = adminSaveDiscipline('me', { exercise_id: 'ex1', enabled: false })
    await expect(p).rejects.toBeInstanceOf(AdminError)
    await expect(adminSaveDiscipline('me', { exercise_id: 'ex1' })).rejects.toThrow('not admin')
    expect(mocks.invalidateRatingCache).not.toHaveBeenCalled()
  })

  it('ошибка без текста → общий текст', async () => {
    mocks.rpc.mockResolvedValue({ error: {} })
    await expect(adminSaveDiscipline('me', { exercise_id: 'ex1' })).rejects.toThrow('Не удалось сохранить дисциплину')
  })

  it('учетка сменилась, пока шел запрос, — в чужую базу ничего не пишем', async () => {
    mocks.rpc.mockImplementation(async () => { mocks.db = { name: 'other' }; return { error: null } })
    await expect(adminSaveDiscipline('me', { exercise_id: 'ex1' })).resolves.toBeUndefined()
    expect(mocks.invalidateRatingCache).not.toHaveBeenCalled()
    expect(mocks.fetchRatingCatalog).not.toHaveBeenCalled()
  })

  it('сбой обновления каталога не превращает принятое сохранение в отказ', async () => {
    mocks.fetchRatingCatalog.mockRejectedValue(new Error('offline'))
    await expect(adminSaveDiscipline('me', { exercise_id: 'ex1' })).resolves.toEqual({ refreshed: false })
  })
})
