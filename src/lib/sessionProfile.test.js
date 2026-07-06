import { describe, it, expect } from 'vitest'
import { readStoredUserId, hydrateProfile } from './sessionProfile.js'

describe('readStoredUserId', () => {
  it('новый тонкий формат {id}', () => {
    expect(readStoredUserId(JSON.stringify({ id: 'u1' }))).toBe('u1')
  })
  it('старый толстый формат {id,name,role} → берём только id', () => {
    expect(readStoredUserId(JSON.stringify({ id: 'u1', name: 'Аня', role: 'admin' }))).toBe('u1')
  })
  it('голая id-строка (не-JSON)', () => {
    expect(readStoredUserId('u1')).toBe('u1')
  })
  it('JSON-строка в кавычках', () => {
    expect(readStoredUserId('"u1"')).toBe('u1')
  })
  it('пусто/null → null', () => {
    expect(readStoredUserId(null)).toBe(null)
    expect(readStoredUserId('')).toBe(null)
  })
  it('объект без id → null', () => {
    expect(readStoredUserId(JSON.stringify({ name: 'Аня' }))).toBe(null)
  })
})

describe('hydrateProfile', () => {
  it('имя из ростера, роль из кэша PIN', () => {
    expect(hydrateProfile('u1', { name: 'Аня' }, { name: 'Старое', role: 'admin' }))
      .toEqual({ id: 'u1', name: 'Аня', role: 'admin' })
  })
  it('ростер пуст → имя из кэша', () => {
    expect(hydrateProfile('u1', null, { name: 'Аня', role: 'member' }))
      .toEqual({ id: 'u1', name: 'Аня', role: 'member' })
  })
  it('нет ни ростера, ни кэша → name/role = null', () => {
    expect(hydrateProfile('u1', null, null)).toEqual({ id: 'u1', name: null, role: null })
  })
  it('роль есть только в кэше PIN (ростер её не отдаёт)', () => {
    // roster (login_users) не содержит role — даже если передать, роль берём из cache
    expect(hydrateProfile('u1', { name: 'Аня', role: 'admin' }, { name: 'Аня', role: 'member' }).role)
      .toBe('member')
  })
  it('роль по умолчанию null, когда кэша нет (не-админ)', () => {
    expect(hydrateProfile('u1', { name: 'Аня' }, null).role).toBe(null)
  })
})
