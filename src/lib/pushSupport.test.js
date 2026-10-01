import { describe, it, expect } from 'vitest'
import {
  pushAvailability,
  isIOSDevice,
  urlB64ToUint8Array,
  subscriptionArgs,
  pushSubtitle,
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
  it('у каждого состояния своя подсказка', () => {
    expect(pushSubtitle('ios-install')).toMatch(/экране «Домой»/)
    expect(pushSubtitle('unsupported')).toMatch(/не умеет/)
    expect(pushSubtitle('denied')).toMatch(/Запрещены/)
    expect(pushSubtitle('ok', false)).toMatch(/Реакции/)
    expect(pushSubtitle('ok', true)).toMatch(/Придут/)
  })
})
