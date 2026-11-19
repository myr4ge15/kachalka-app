const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

// Визуальная копия живет в координатах окна. Раскладкой и данными владеет useSortable.
export function createSortChip(label, card, x, y) {
  const el = document.createElement('div')
  el.className = 'sort-chip'
  el.textContent = label
  el.setAttribute('aria-hidden', 'true')
  document.body.append(el)
  const { width, height } = el.getBoundingClientRect()
  const anchor = clamp(x - card.left, 12, width / 2)
  function move(cx, cy) {
    const left = clamp(cx - anchor, 0, window.innerWidth - width)
    const top = clamp(cy - height / 2, 0, window.innerHeight - height)
    el.style.transform = `translate3d(${left}px,${top}px,0)`
  }
  move(x, y)
  function landInTrash(rect) {
    const scale = 0.12
    const left = rect.left + (rect.width - width * scale) / 2
    const top = rect.top + (rect.height - height * scale) / 2
    el.classList.add('sort-chip--landing')
    el.style.transform = `translate3d(${left}px,${top}px,0) scale(${scale})`
    el.style.opacity = '0'
  }
  return { move, landInTrash, remove: () => el.remove() }
}
