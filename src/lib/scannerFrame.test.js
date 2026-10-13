import { describe, it, expect } from 'vitest'
import { frameHasDetail, guideCrop } from './scannerFrame.js'
it('rejects a covered lens and flat surfaces, accepts a contrasting label', () => {
  expect(frameHasDetail(new Uint8ClampedArray(400))).toBe(false)
  expect(frameHasDetail(new Uint8ClampedArray(400).fill(220))).toBe(false)
  const label = new Uint8ClampedArray(400)
  label.fill(255, 200)
  expect(frameHasDetail(label)).toBe(true)
})

describe('guideCrop', () => {
  it('maps the guide through object-fit: cover', () => {
    // 1280×720 frame in a 390×844 portrait box: scale by height, sides cropped.
    const box = { left: 0, top: 0, width: 390, height: 844 }
    const guide = { left: 22, top: 300, width: 346, height: 140 }
    const scale = 844 / 720, ox = (390 - 1280 * scale) / 2
    expect(guideCrop(1280, 720, box, guide)).toEqual({
      sx: Math.round((22 - ox) / scale), sy: Math.round(300 / scale),
      sw: Math.round(346 / scale), sh: Math.round(140 / scale),
    })
  })
  it('respects the box offset and clamps to the frame', () => {
    const box = { left: 100, top: 50, width: 640, height: 360 }
    expect(guideCrop(1280, 720, box, { left: 80, top: 30, width: 700, height: 100 })).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 160 })
  })
  it('falls back to the central strip before layout', () => {
    expect(guideCrop(1280, 720, { width: 0, height: 0 }, null)).toEqual({ sx: 0, sy: 180, sw: 1280, sh: 360 })
  })
})
