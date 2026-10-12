import { it, expect } from 'vitest'
import { frameHasDetail } from './scannerFrame.js'
it('rejects a covered lens and flat surfaces, accepts a contrasting label', () => {
  expect(frameHasDetail(new Uint8ClampedArray(400))).toBe(false)
  expect(frameHasDetail(new Uint8ClampedArray(400).fill(220))).toBe(false)
  const label = new Uint8ClampedArray(400)
  label.fill(255, 200)
  expect(frameHasDetail(label)).toBe(true)
})
