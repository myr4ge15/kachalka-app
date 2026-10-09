import { describe, it, expect } from 'vitest'
import {
  pushAvailability,
  isIOSDevice,
  urlB64ToUint8Array,
  isStaleServerKey,
  subscriptionArgs,
  pushSubtitle,
  shouldAskPush,
  desktopAvailability,
  pushRowSubtitle,
  PUSH_TYPES,
  isPushTypeOn,
} from './pushSupport.js'

const base = { configured: true, supported: true, isIOS: false, standalone: false, permission: 'default' }

describe('pushAvailability', () => {
  it('без VAPID-ключа в сборке функции нет вовсе', () => {
    expect(pushAvailability({ ...base, configured: false })).toBe('off')
    expect(pushAvailability({ ...base, configured: false, isIOS: true })).toBe('off')
  })
  it('iPhone во вкладке Safari — сначала установить на экран «Домой»', () => {
    // В обычной вкладке у Safari нет PushManager — и все равно показываем подсказку, а не «не умеет».
    expect(pushAvailability({ ...base, isIOS: true, supported: false })).toBe('ios-install')
  })
  it('iPhone с экрана «Домой» — как обычный браузер', () => {
    expect(pushAvailability({ ...base, isIOS: true, standalone: true })).toBe('ok')
    expect(pushAvailability({ ...base, isIOS: true, standalone: true, supported: false })).toBe('unsupported')
  })
  it('запрет в браузере и обычный случай', () => {
    expect(pushAvailability({ ...base, permission: 'denied' })).toBe('denied')
    expect(pushAvailability({ ...base, permission: 'granted' })).toBe('ok')
    expect(pushAvailability(base)).toBe('ok')
  })
  it('без поддержки — unsupported, даже если разрешение запрещено', () => {
    expect(pushAvailability({ ...base, supported: false, permission: 'denied' })).toBe('unsupported')
  })
})

describe('isIOSDevice', () => {
  it('iPhone и iPad по userAgent', () => {
    expect(isIOSDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' })).toBe(true)
    expect(isIOSDevice({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_4 like Mac OS X)' })).toBe(true)
  })
  it('iPadOS, притворяющийся Mac, — по тачу', () => {
    expect(isIOSDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
  })
  it('настоящий Mac и Android — нет', () => {
    expect(isIOSDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
    expect(isIOSDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false)
    expect(isIOSDevice()).toBe(false)
  })
})

describe('urlB64ToUint8Array', () => {
  it('декодирует base64url без паддинга', () => {
    // «hello?» → aGVsbG8_ (base64url, '?' дает '_')
    expect(Array.from(urlB64ToUint8Array('aGVsbG8_'))).toEqual([104, 101, 108, 108, 111, 63])
    // 'ab' → YWI (паддинг дописывается сам)
    expect(Array.from(urlB64ToUint8Array('YWI'))).toEqual([97, 98])
  })
  it('VAPID-ключ — 65 байт несжатой точки P-256', () => {
    const key = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
    const bytes = urlB64ToUint8Array(key)
    expect(bytes.length).toBe(65)
    expect(bytes[0]).toBe(4)
  })
})

describe('subscriptionArgs', () => {
  const json = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'P', auth: 'A' } }
  it('собирает аргументы RPC и обрезает userAgent', () => {
    const args = subscriptionArgs(json, 'x'.repeat(400))
    expect(args).toMatchObject({ p_endpoint: json.endpoint, p_p256dh: 'P', p_auth: 'A' })
    expect(args.p_user_agent).toHaveLength(300)
    expect(subscriptionArgs(json).p_user_agent).toBeNull()
  })
  it('неполная или не https подписка — null', () => {
    expect(subscriptionArgs(null)).toBeNull()
    expect(subscriptionArgs({ ...json, endpoint: 'http://x' })).toBeNull()
    expect(subscriptionArgs({ ...json, keys: { p256dh: 'P' } })).toBeNull()
  })
})

describe('pushSubtitle', () => {
  it('подсказка — только когда включить отсюда нельзя', () => {
    expect(pushSubtitle('ios-install')).toMatch(/экране «Домой»/)
    expect(pushSubtitle('unsupported')).toMatch(/не умеет/)
    expect(pushSubtitle('denied')).toMatch(/Запрещены/)
    expect(pushSubtitle('ok')).toBe('')
  })
})

describe('shouldAskPush', () => {
  const ask = { availability: 'ok', permission: 'default', enabled: false, asked: false }
  it('спрашиваем, если можно включить одним нажатием и еще не спрашивали', () => {
    expect(shouldAskPush(ask)).toBe(true)
  })
  it('не спрашиваем повторно и не спрашиваем, когда уже включено', () => {
    expect(shouldAskPush({ ...ask, asked: true })).toBe(false)
    expect(shouldAskPush({ ...ask, enabled: true })).toBe(false)
  })
  it('браузер уже отвечал (разрешил или запретил) — не пристаем', () => {
    expect(shouldAskPush({ ...ask, permission: 'granted' })).toBe(false)
    expect(shouldAskPush({ ...ask, permission: 'denied' })).toBe(false)
  })
  it('iPhone вне экрана «Домой», без ключа или без поддержки — не спрашиваем', () => {
    for (const availability of ['ios-install', 'off', 'unsupported', 'denied', null]) {
      expect(shouldAskPush({ ...ask, availability })).toBe(false)
    }
  })
})

describe('типы пушей', () => {
  it('пять типов, ключи совпадают с белым списком set_push_pref', () => {
    expect(PUSH_TYPES.map((t) => t.type)).toEqual(['reaction', 'record', 'overtake', 'reminder', 'update'])
  })
  it('по умолчанию все включено, выключено — только явным false', () => {
    expect(isPushTypeOn({}, 'reminder')).toBe(true)
    expect(isPushTypeOn(null, 'update')).toBe(true)
    expect(isPushTypeOn({ reminder: false }, 'reminder')).toBe(false)
    expect(isPushTypeOn({ reminder: true }, 'reminder')).toBe(true)
  })
})

// РЕВЬЮ-КОДА-2026-10-02, мелочи: после смены VAPID-ключа старая подписка
// переиспользовалась вечно.
describe('isStaleServerKey', () => {
  const key = new Uint8Array([4, 1, 2, 3])
  it('тот же ключ (ArrayBuffer из подписки) — не устарел', () => {
    expect(isStaleServerKey(new Uint8Array([4, 1, 2, 3]).buffer, key)).toBe(false)
  })
  it('другие байты или длина — устарел', () => {
    expect(isStaleServerKey(new Uint8Array([4, 1, 2, 9]).buffer, key)).toBe(true)
    expect(isStaleServerKey(new Uint8Array([4, 1, 2]).buffer, key)).toBe(true)
  })
  it('ключ подписки неизвестен (нет options / null) — не пересоздаем вслепую', () => {
    expect(isStaleServerKey(undefined, key)).toBe(false)
    expect(isStaleServerKey(null, key)).toBe(false)
  })
  it('ключ сборки пуст — сравнивать не с чем', () => {
    expect(isStaleServerKey(new Uint8Array([1]).buffer, new Uint8Array(0))).toBe(false)
  })
  it('принимает и типизированные массивы-срезы', () => {
    const big = new Uint8Array([9, 4, 1, 2, 3])
    expect(isStaleServerKey(big.subarray(1), key)).toBe(false)
  })
})

describe('desktopAvailability (v7.1.4)', () => {
  it('на компьютере пуши скрыты, пока не включены в этом браузере', () => {
    expect(desktopAvailability('ok', { desktop: true })).toBe('off')
    expect(desktopAvailability('denied', { desktop: true })).toBe('off')
    expect(desktopAvailability('unsupported', { desktop: true })).toBe('off')
  })
  it('уже включенные на компьютере — строка остается, чтобы выключить', () => {
    expect(desktopAvailability('ok', { desktop: true, enabled: true })).toBe('ok')
  })
  it('телефон — без изменений', () => {
    expect(desktopAvailability('ok', { desktop: false })).toBe('ok')
    expect(desktopAvailability('ios-install')).toBe('ios-install')
  })
  it('скрытые на компьютере пуши не зовут стартовый лист', () => {
    const availability = desktopAvailability('ok', { desktop: true })
    expect(shouldAskPush({ availability, permission: 'default', enabled: false, asked: false })).toBe(false)
  })
})

describe('pushRowSubtitle (v7.1.4)', () => {
  it('включены — со счетчиком типов, пока грузятся — без него', () => {
    expect(pushRowSubtitle({ availability: 'ok', enabled: true, prefs: { reminder: false } })).toBe('включены · 4 из 5')
    expect(pushRowSubtitle({ availability: 'ok', enabled: true, prefs: {} })).toBe('включены · 5 из 5')
    expect(pushRowSubtitle({ availability: 'ok', enabled: true })).toBe('включены')
  })
  it('выключены и случаи, когда включить нельзя', () => {
    expect(pushRowSubtitle({ availability: 'ok', enabled: false })).toBe('выключены')
    expect(pushRowSubtitle({ availability: 'denied' })).toMatch(/запрещены/)
    expect(pushRowSubtitle({ availability: 'ios-install' })).toMatch(/«Домой»/)
    expect(pushRowSubtitle({ availability: 'unsupported' })).toMatch(/не умеет/)
    expect(pushRowSubtitle({ availability: 'off' })).toBe('')
  })
})
