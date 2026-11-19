const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

// Визуальная копия живет в координатах окна. Раскладкой и данными владеет useSortable.
export function createSortChip(label, card, x, y, reduced) {
  const el = document.createElement('div')
  el.className = 'sort-chip'
  const surface = document.createElement('span')
  surface.className = 'sort-chip-surface'
  const name = document.createElement('span')
  name.className = 'sort-chip-name'
  name.textContent = label
  el.append(surface, name)
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
  if (!reduced && surface.animate) {
    const start = el.getBoundingClientRect()
    surface.animate([
      { transform: `translate(${card.left - start.left}px,${card.top - start.top}px) scale(${card.width / width},${card.height / height})` },
      { transform: 'none' },
    ], { duration: 150, easing: 'ease-out' })
  }
  function land(rect, trash) {
    const scale = trash ? 0.12 : 1
    const left = rect.left + (rect.width - width * scale) / 2
    const top = rect.top + (rect.height - height * scale) / 2
    surface.getAnimations?.().forEach(animation => animation.cancel())
    el.classList.add('sort-chip--landing')
    el.style.transform = `translate3d(${left}px,${top}px,0) scale(${scale})`
    if (trash) el.style.opacity = '0'
  }
  return { move, land, remove: () => el.remove() }
}
