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
