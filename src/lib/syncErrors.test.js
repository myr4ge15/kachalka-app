import { describe, it, expect } from 'vitest'
import { isTransientSyncError } from './syncErrors.js'

describe('isTransientSyncError', () => {
  it('таймаут и отмена запроса — временные', () => {
    expect(isTransientSyncError(new Error('Превышено время ожидания сети. Проверь связь и попробуй еще раз.'))).toBe(true)
    const abort = new Error('The operation was aborted'); abort.name = 'AbortError'
    expect(isTransientSyncError(abort)).toBe(true)
  })

  it('сбой fetch от supabase-js (объект без кода) — временный', () => {
    expect(isTransientSyncError({ message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' })).toBe(true)
    expect(isTransientSyncError({ message: 'TypeError: Load failed' })).toBe(true)
    expect(isTransientSyncError({ message: '<html>502 Bad Gateway</html>' })).toBe(true)
  })

  it('истекший JWT и недоступная база — временные', () => {
    expect(isTransientSyncError({ code: 'PGRST301', message: 'JWT expired' })).toBe(true)
    expect(isTransientSyncError({ code: 'PGRST002', message: 'schema cache' })).toBe(true)
    expect(isTransientSyncError({ code: '57014', message: 'statement timeout' })).toBe(true)
    expect(isTransientSyncError({ code: '40001', message: 'serialization failure' })).toBe(true)
    expect(isTransientSyncError({ code: '08006', message: 'connection failure' })).toBe(true)
  })

  it('сервер отверг данные — постоянная', () => {
    expect(isTransientSyncError({ code: '23503', message: 'foreign key violation' })).toBe(false)
    expect(isTransientSyncError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isTransientSyncError({ code: '22P02', message: 'invalid input syntax for type uuid' })).toBe(false)
    expect(isTransientSyncError({ code: 'PGRST116', message: 'no rows' })).toBe(false)
    expect(isTransientSyncError({ code: 'P0001', message: 'unknown user_meta key' })).toBe(false)
  })

  it('исключение в обработчике (Error без кода) — постоянная', () => {
    expect(isTransientSyncError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false)
    expect(isTransientSyncError(new Error('boom'))).toBe(false)
  })

  it('пусто — не временная', () => {
    expect(isTransientSyncError(null)).toBe(false)
    expect(isTransientSyncError(undefined)).toBe(false)
  })
})
