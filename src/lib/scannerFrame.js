// Sample luminance before OCR: a covered lens or uniform surface is not text.
// This is a blank-frame gate, not a promise of sharpness/readability.
export function frameHasDetail(data) {
  let sum = 0, squares = 0, count = 0
  const step = Math.max(4, Math.floor(data.length / (4 * 2048)) * 4)
  for (let i = 0; i < data.length; i += step) {
    const l = (data[i] + data[i + 1] + data[i + 2]) / 3
    sum += l; squares += l * l; count++
  }
  if (!count) return false
  const mean = sum / count
  return mean > 12 && squares / count - mean * mean > 100
}

// The region of the video frame under the on-screen guide. The video is shown
// with object-fit: cover, so the visible picture is scaled and cropped: map the
// guide's screen rectangle back to frame pixels. No layout yet (box 0×0) —
// fall back to the central horizontal strip.
export function guideCrop(frameW, frameH, box, guide) {
  const strip = { sx: 0, sy: Math.round(frameH * 0.25), sw: frameW, sh: Math.round(frameH * 0.5) }
  if (!frameW || !frameH || !box?.width || !box?.height || !guide?.width || !guide?.height) return strip
  const scale = Math.max(box.width / frameW, box.height / frameH)
  const ox = (box.width - frameW * scale) / 2, oy = (box.height - frameH * scale) / 2
  const x0 = Math.max(0, (guide.left - box.left - ox) / scale)
  const y0 = Math.max(0, (guide.top - box.top - oy) / scale)
  const x1 = Math.min(frameW, (guide.left + guide.width - box.left - ox) / scale)
  const y1 = Math.min(frameH, (guide.top + guide.height - box.top - oy) / scale)
  if (x1 - x0 < 8 || y1 - y0 < 8) return strip
  return { sx: Math.round(x0), sy: Math.round(y0), sw: Math.round(x1 - x0), sh: Math.round(y1 - y0) }
}
