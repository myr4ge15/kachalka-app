// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { createSortChip } from './sortChip.js'

it('сжимает фон карточки, при отпускании прерывает подъем и направляет плашку в корзину', () => {
  const animate = vi.fn()
  const cancel = vi.fn()
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 20, top: 40, width: 100, height: 40,
  })
  const proto = HTMLElement.prototype
  const saved = Object.getOwnPropertyDescriptors(proto)
  Object.defineProperties(proto, {
    animate: { configurable: true, value: animate },
    getAnimations: { configurable: true, value: () => [{ cancel }] },
  })
  try {
    const chip = createSortChip('Жим', { left: 20, top: 40, width: 300, height: 120 }, 40, 60, false)
    expect(animate.mock.calls[0][0][0].transform).toContain('scale(3,3)')
    chip.land({ left: 100, top: 700, width: 160, height: 56 }, true)
    expect(cancel).toHaveBeenCalledOnce()
    expect(document.querySelector('.sort-chip').style.transform).toContain('scale(0.12)')
    chip.remove()
  } finally {
    bounds.mockRestore()
    for (const key of ['animate', 'getAnimations']) {
      if (saved[key]) Object.defineProperty(proto, key, saved[key])
      else delete proto[key]
    }
  }
})
