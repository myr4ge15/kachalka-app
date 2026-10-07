import { describe, it, expect } from 'vitest'
import { resetFromUrl, stripReset, normalizeRecoveryCode, recoveryCodeLooksValid, tgStartLink, resetErrorText } from './recovery.js'

const T = 'a_tiNNP3RyzFJHQdG_xlbBkLpflaqExEUJzq2xU0eXo'

describe('токен сброса в адресе', () => {
  it('берется из фрагмента #reset=…, мусор — null', () => {
    expect(resetFromUrl(`https://x.io/kachalka-app/#reset=${T}`)).toBe(T)
    expect(resetFromUrl('https://x.io/kachalka-app/#reset=short')).toBe(null)
    expect(resetFromUrl('https://x.io/kachalka-app/')).toBe(null)
    expect(resetFromUrl('не адрес')).toBe(null)
  })
  it('стирается из адреса; стирать нечего — null', () => {
    expect(stripReset(`https://x.io/kachalka-app/#reset=${T}`)).toBe('https://x.io/kachalka-app/')
    expect(stripReset('https://x.io/kachalka-app/#invite=x')).toBe(null)
  })
})

describe('код восстановления', () => {
  it('регистр, дефисы, пробелы, O/0 и I/L/1 не важны — как на сервере', () => {
    expect(normalizeRecoveryCode('o1il-ab cd')).toBe('0111ABCD')
    expect(recoveryCodeLooksValid('abcd-efgh-jkmn-pqrs')).toBe(true)
    expect(recoveryCodeLooksValid('ABCD EFGH JKMN PQR')).toBe(false)
    expect(recoveryCodeLooksValid('ABCD-EFGH-JKMN-PQRU')).toBe(false) // U в алфавите нет
  })
})

describe('ссылка привязки Telegram', () => {
  it('t.me/<бот>?start=<токен>; кривое — null', () => {
    expect(tgStartLink('@kachalka_bot', T)).toBe(`https://t.me/kachalka_bot?start=${T}`)
    expect(tgStartLink('', T)).toBe(null)
    expect(tgStartLink('bot name', T)).toBe(null)
    expect(tgStartLink('kachalka_bot', 'short')).toBe(null)
  })
})

it('тексты ошибок', () => {
  expect(resetErrorText('invalid')).toMatch(/код не подходят/)
  expect(resetErrorText('expired')).toMatch(/устарела/)
  expect(resetErrorText('locked')).toMatch(/подожди/)
  expect(resetErrorText('???')).toMatch(/еще раз/)
})
