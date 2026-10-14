import { describe, it, expect } from 'vitest'
import { pickMainBackCamera } from './scannerCamera.js'

const cam = (deviceId, label) => ({ kind: 'videoinput', deviceId, label })

describe('pickMainBackCamera — основной объектив вместо виртуальной мультикамеры iPhone', () => {
  it('iPhone 15 Pro, английский: «Back Camera», а не «Back Triple Camera»', () => {
    expect(pickMainBackCamera([
      cam('f', 'Front Camera'),
      cam('t', 'Back Triple Camera'),
      cam('dw', 'Back Dual Wide Camera'),
      cam('d', 'Back Dual Camera'),
      cam('u', 'Back Ultra Wide Camera'),
      cam('tele', 'Back Telephoto Camera'),
      cam('m', 'Back Camera'),
      { kind: 'audioinput', deviceId: 'mic', label: 'iPhone Microphone' },
    ])).toBe('m')
  })
  it('iPhone, русский интерфейс', () => {
    expect(pickMainBackCamera([
      cam('f', 'Передняя камера'),
      cam('t', 'Задняя тройная камера'),
      cam('dw', 'Задняя двойная широкоугольная камера'),
      cam('u', 'Задняя сверхширокоугольная камера'),
      cam('tele', 'Задняя телефотокамера'),
      cam('m', 'Задняя камера'),
    ])).toBe('m')
  })
  it('нет виртуальной камеры (Android, простой iPhone) — не вмешиваемся', () => {
    expect(pickMainBackCamera([cam('a', 'camera2 0, facing back'), cam('b', 'camera2 2, facing back')])).toBeNull()
    expect(pickMainBackCamera([cam('f', 'Front Camera'), cam('m', 'Back Camera')])).toBeNull()
  })
  it('подписей нет (до разрешения) или основная неоднозначна — null', () => {
    expect(pickMainBackCamera([cam('a', ''), cam('b', '')])).toBeNull()
    expect(pickMainBackCamera([cam('t', 'Back Triple Camera'), cam('m1', 'Back Camera'), cam('m2', 'Back Camera')])).toBeNull()
    expect(pickMainBackCamera(undefined)).toBeNull()
  })
})
