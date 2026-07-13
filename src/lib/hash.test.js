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

// KAT (known-answer test): фиксированные pin+salt → заранее посчитанный hex.
// Эталон получен node crypto (pbkdf2Sync/createHash) — тем же кодом, что seed.sql
// и сервер (_shared/pin.ts). Ловит ТИХИЙ дрейф параметров (число итераций, длина,
// кодировка): round-trip-тест выше его бы пропустил (обе стороны меняются вместе).
describe('hash KAT — паритет параметров с сервером', () => {
  it('pbkdf2Hex(1234, 0011223344556677) даёт эталонный hex (100000 итераций, 32 байта)', async () => {
    expect(await pbkdf2Hex('1234', '0011223344556677')).toBe(
      '9468fd4b6f1aa98e82511e7df181adf8b1579f1f20a065b32836cb8c728cb78e'
    )
  })
  it('sha256Hex(1234) даёт эталонный hex (legacy-схема)', async () => {
    expect(await sha256Hex('1234')).toBe(
      '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'
    )
  })
})
