import { describe, it, expect } from 'vitest'
import { constantTimeHexEqual, verifyPin, pbkdf2Hex, sha256Hex } from './hash.js'

describe('constantTimeHexEqual', () => {
  it('равные строки → true', () => {
    expect(constantTimeHexEqual('deadbeef', 'deadbeef')).toBe(true)
  })
  it('разные строки той же длины → false', () => {
    expect(constantTimeHexEqual('deadbeef', 'deadbeff')).toBe(false)
  })
  it('разная длина → false (без исключения)', () => {
    expect(constantTimeHexEqual('dead', 'deadbeef')).toBe(false)
  })
  it('нестроковый вход → false', () => {
    expect(constantTimeHexEqual(undefined, 'dead')).toBe(false)
    expect(constantTimeHexEqual('dead', null)).toBe(false)
  })
  it('пустые строки равны', () => {
    expect(constantTimeHexEqual('', '')).toBe(true)
  })
})

describe('verifyPin (constant-time)', () => {
  it('верный PIN по PBKDF2-схеме (с солью) → true', async () => {
    const salt = '00112233445566778899aabbccddeeff'
    const hash = await pbkdf2Hex('1234', salt)
    expect(await verifyPin('1234', { pin_hash: hash, pin_salt: salt })).toBe(true)
    expect(await verifyPin('0000', { pin_hash: hash, pin_salt: salt })).toBe(false)
  })
  it('верный PIN по legacy SHA-256 (без соли) → true', async () => {
    const hash = await sha256Hex('4321')
    expect(await verifyPin('4321', { pin_hash: hash })).toBe(true)
    expect(await verifyPin('1111', { pin_hash: hash })).toBe(false)
  })
  it('нет pin_hash → false (не бросает)', async () => {
    expect(await verifyPin('1234', {})).toBe(false)
    expect(await verifyPin('1234', null)).toBe(false)
  })
})
