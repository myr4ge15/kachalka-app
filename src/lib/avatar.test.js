import { describe, it, expect, vi } from 'vitest'

// avatar.js статически импортит supabase-клиент (createClient падает без env) —
// мокаем его, чтобы тестировать только чистые fitDimensions/isHeic (без DOM/сети).
vi.mock('../db/supabase.js', () => ({ supabase: {} }))

import { fitDimensions, isHeic } from './avatar.js'

// Мок File: isHeic читает только type/name и первые 16 байт (slice→arrayBuffer).
const fileOf = (bytes = [], { type = '', name = '' } = {}) => ({
  type,
  name,
  slice: (a, b) => ({ arrayBuffer: async () => Uint8Array.from(bytes.slice(a, b)).buffer }),
})

// ISO-BMFF заголовок: 4 байта размера + 'ftyp' + brand (+ паддинг до 16).
const ftyp = (brand, pad = 'mif1') => {
  const bytes = [0, 0, 0, 24]
  for (const s of [`ftyp`, brand, pad]) for (const ch of s) bytes.push(ch.charCodeAt(0))
  return bytes
}

describe('fitDimensions', () => {
  it('уменьшает по большей стороне, сохраняя пропорции', () => {
    expect(fitDimensions(400, 200, 256)).toEqual({ w: 256, h: 128 })
    expect(fitDimensions(200, 400, 256)).toEqual({ w: 128, h: 256 })
  })
  it('не апскейлит (scale ≤ 1)', () => {
    expect(fitDimensions(100, 100, 256)).toEqual({ w: 100, h: 100 })
    expect(fitDimensions(64, 32, 256)).toEqual({ w: 64, h: 32 })
  })
  it('дробный масштаб округляется', () => {
    expect(fitDimensions(300, 100, 256)).toEqual({ w: 256, h: 85 })
  })
  it('нулевые/крошечные размеры не дают 0 (минимум 1px)', () => {
    expect(fitDimensions(0, 0, 256)).toEqual({ w: 1, h: 1 })
    expect(fitDimensions(1, 0, 256)).toEqual({ w: 1, h: 1 })
  })
  it('дефолтный max = 256', () => {
    expect(fitDimensions(512, 256)).toEqual({ w: 256, h: 128 })
  })
})

describe('isHeic', () => {
  it('распознаёт по MIME image/heic и image/heif', async () => {
    expect(await isHeic(fileOf([], { type: 'image/heic' }))).toBe(true)
    expect(await isHeic(fileOf([], { type: 'image/HEIF' }))).toBe(true)
  })
  it('распознаёт по расширению .heic/.heif (регистронезависимо)', async () => {
    expect(await isHeic(fileOf([], { name: 'photo.HEIC' }))).toBe(true)
    expect(await isHeic(fileOf([], { name: 'img.heif' }))).toBe(true)
  })
  it('распознаёт по magic-bytes (ftyp + heic-brand) при пустом type', async () => {
    expect(await isHeic(fileOf(ftyp('heic')))).toBe(true)
    expect(await isHeic(fileOf(ftyp('mif1')))).toBe(true)
  })
  it('обычный JPEG/PNG → false', async () => {
    expect(await isHeic(fileOf([], { type: 'image/jpeg', name: 'a.jpg' }))).toBe(false)
    expect(await isHeic(fileOf(ftyp('isom'), { name: 'movie.mp4' }))).toBe(false)
  })
  it('слишком короткий буфер (<12 байт) → false', async () => {
    expect(await isHeic(fileOf([1, 2, 3, 4]))).toBe(false)
  })
})
