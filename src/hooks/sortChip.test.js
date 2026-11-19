// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { createSortChip } from './sortChip.js'

it('захват высокой карточки сразу показывает компактную плашку, сброс сжимает её в корзину', () => {
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 100, height: 40,
  })
  const chip = createSortChip('Жим', { left: 20, top: 40, width: 300, height: 480 }, 40, 60)
  try {
    const el = document.querySelector('.sort-chip')
    expect(el.textContent).toBe('Жим')
    expect(el.childElementCount).toBe(0)
    expect(el.style.transform).toBe('translate3d(20px,40px,0)')
    chip.move(90, 130)
    expect(el.style.transform).toBe('translate3d(70px,110px,0)')
    chip.landInTrash({ left: 100, top: 700, width: 160, height: 56 })
    expect(el.style.transform).toContain('scale(0.12)')
    expect(el.style.opacity).toBe('0')
  } finally {
    chip.remove()
    bounds.mockRestore()
  }
})
