import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/supabase.js', () => ({ supabase: { auth: {} } }))
import { supabase } from '../db/supabase.js'
import {
  mfaState, needsCode, cleanCode, verifyCode, startEnroll, disableMfa, groupSecret, MfaError,
} from './adminMfa.js'

const ok = (data) => Promise.resolve({ data, error: null })
const fail = (error) => Promise.resolve({ data: null, error })

function fakeAuth({ factors = [], level = 'aal1', verify, enroll } = {}) {
  return {
    mfa: {
      listFactors: vi.fn(() => ok({ all: factors })),
      getAuthenticatorAssuranceLevel: vi.fn(() => ok({ currentLevel: level, nextLevel: level })),
      challengeAndVerify: vi.fn(verify ?? (() => ok({}))),
      enroll: vi.fn(enroll ?? (() => ok({ id: 'f-new', totp: { qr_code: 'data:image/svg+xml;utf8,<svg/>', secret: 'ABCDEFGHIJKL' } }))),
      unenroll: vi.fn(() => ok({})),
    },
  }
}

describe('mfaState / needsCode', () => {
  it('без факторов — 2FA выключена, код не нужен', async () => {
    const st = await mfaState(fakeAuth())
    expect(st).toEqual({ enabled: false, factorId: null, level: 'aal1', pending: [] })
    expect(needsCode(st)).toBe(false)
  })
  it('включена, сессия aal1 — нужен код; aal2 — уже нет', async () => {
    const factors = [{ id: 'f1', factor_type: 'totp', status: 'verified' }]
    const st = await mfaState(fakeAuth({ factors }))
    expect(st).toMatchObject({ enabled: true, factorId: 'f1', level: 'aal1' })
    expect(needsCode(st)).toBe(true)
    expect(needsCode(await mfaState(fakeAuth({ factors, level: 'aal2' })))).toBe(false)
  })
  it('брошенное включение — в pending, а не «включено»', async () => {
    const st = await mfaState(fakeAuth({ factors: [{ id: 'f0', factor_type: 'totp', status: 'unverified' }] }))
    expect(st).toMatchObject({ enabled: false, pending: ['f0'] })
  })
})

describe('verifyCode', () => {
  it('чистит ввод и шлет 6 цифр', async () => {
    const auth = fakeAuth()
    await verifyCode('f1', ' 123 456 ', auth)
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '123456' })
  })
  it('короткий код — отказ без запроса', async () => {
    const auth = fakeAuth()
    await expect(verifyCode('f1', '123', auth)).rejects.toMatchObject({ code: 'bad_code' })
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled()
  })
  it('неверный код — понятная ошибка', async () => {
    const auth = fakeAuth({ verify: () => fail({ code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' }) })
    const err = await verifyCode('f1', '000000', auth).catch((e) => e)
    expect(err).toBeInstanceOf(MfaError)
    expect(err.code).toBe('bad_code')
    expect(err.message).toMatch(/Код не подошел/)
  })
  it('TOTP выключен в проекте — подсказка, где включить', async () => {
    const auth = fakeAuth({ enroll: () => fail({ code: 'mfa_totp_enroll_not_enabled', message: 'MFA enroll is disabled for TOTP' }) })
    await expect(startEnroll({ pending: [] }, auth)).rejects.toMatchObject({ code: 'disabled' })
  })
})

describe('startEnroll / disableMfa', () => {
  it('сначала убирает брошенные факторы, потом заводит новый', async () => {
    const auth = fakeAuth()
    const r = await startEnroll({ pending: ['f0'] }, auth)
    expect(auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f0' })
    expect(auth.mfa.enroll).toHaveBeenCalledWith(expect.objectContaining({ factorType: 'totp' }))
    expect(r).toEqual({ factorId: 'f-new', qr: 'data:image/svg+xml;utf8,<svg/>', secret: 'ABCDEFGHIJKL' })
  })
  it('отключение — unenroll фактора', async () => {
    const auth = fakeAuth()
    await disableMfa('f1', auth)
    expect(auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f1' })
  })
})

describe('мелочи', () => {
  it('cleanCode и groupSecret', () => {
    expect(cleanCode('12-34 56 7')).toBe('123456')
    expect(groupSecret('ABCDEFGHIJ')).toBe('ABCD EFGH IJ')
    expect(cleanCode(null)).toBe('')
    expect(groupSecret(null)).toBe('')
    expect(needsCode(null)).toBe(false)
  })
})

describe('ответы транспорта MFA', () => {
  it('использует клиент Supabase по умолчанию и читает состояние без факторов', async () => {
    const auth = fakeAuth()
    supabase.auth = auth
    auth.mfa.listFactors.mockResolvedValueOnce(undefined)
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({ data: null })
    expect(await mfaState()).toEqual({ enabled: false, factorId: null, level: 'aal1', pending: [] })
    auth.mfa.listFactors.mockResolvedValueOnce({ data: {} })
    expect(await mfaState()).toMatchObject({ enabled: false, pending: [] })
    await expect(verifyCode('f1', '123456')).resolves.toBe(true)
    await expect(startEnroll(undefined)).resolves.toMatchObject({ factorId: 'f-new' })
    await expect(disableMfa('f1')).resolves.toBe(true)
    expect(auth.mfa.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: 'f1' })
  })

  it('игнорирует отсутствующие записи и факторы других типов', async () => {
    const auth = fakeAuth({ factors: [null, { id: 'phone', factor_type: 'phone', status: 'verified' }] })
    expect(await mfaState(auth)).toMatchObject({ enabled: false, factorId: null, pending: [] })
  })

  it.each([
    [new Error('fetch timeout'), 'network', 'Нет сети — попробуй позже.'],
    [{ message: 'Сбой проверки' }, 'server', 'Сбой проверки'],
    [undefined, 'server', 'Не получилось. Попробуй еще раз.'],
  ])('преобразует отклоненный запрос %s в ошибку MFA', async (error, code, message) => {
    const auth = fakeAuth({ verify: () => Promise.reject(error) })
    await expect(verifyCode('f1', '123456', auth)).rejects.toMatchObject({ code, message })
  })

  it.each([undefined, {}])('при неполном ответе регистрации %j сохраняет id фактора', async (totp) => {
    const auth = fakeAuth({ enroll: () => ok({ id: 'f1', totp }) })
    expect(await startEnroll({}, auth)).toEqual({ factorId: 'f1', qr: null, secret: '' })
    expect(auth.mfa.unenroll).not.toHaveBeenCalled()
  })
})
