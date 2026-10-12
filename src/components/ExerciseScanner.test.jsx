// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ExerciseScanner from './ExerciseScanner.jsx'
import { createScannerWorker } from '../services/scannerOcr.js'
vi.mock('../services/scannerOcr.js', () => ({ createScannerWorker: vi.fn() }))
let stop, worker
const exercises = [{ id: 'lat', name: 'Тяга верхнего блока', muscle_group: 'спина' }]
beforeEach(() => {
  stop = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) } })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1280 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 720 })
  worker = { terminate: vi.fn(), setParameters: vi.fn().mockResolvedValue(), recognize: vi.fn().mockResolvedValue({ data: { text: 'LAT PULLDOWN', confidence: 95 } }) }
  createScannerWorker.mockResolvedValue(worker)
})
afterEach(() => vi.restoreAllMocks())
it('never picks automatically; stops camera on stable result and requires confirmation', async () => {
  const onPick = vi.fn()
  render(<ExerciseScanner exercises={exercises} onPick={onPick} onClose={vi.fn()} onManual={vi.fn()} />)
  await screen.findByRole('button', { name: /Тяга верхнего блока/ }, { timeout: 4000 })
  expect(stop).toHaveBeenCalled()
  expect(worker.terminate).toHaveBeenCalled()
  expect(onPick).not.toHaveBeenCalled()
  expect(screen.getByText('Выбрать упражнение')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /Тяга верхнего блока/ }))
  fireEvent.click(screen.getByText('Выбрать упражнение'))
  expect(onPick).toHaveBeenCalledWith(exercises[0])
})
it('releases a camera permission response arriving after close', async () => {
  let grant
  navigator.mediaDevices.getUserMedia.mockReturnValue(new Promise(resolve => { grant = resolve }))
  const { unmount } = render(<ExerciseScanner exercises={[]} onClose={vi.fn()} onManual={vi.fn()} />)
  unmount()
  grant({ getTracks: () => [{ stop }] })
  await waitFor(() => expect(stop).toHaveBeenCalled())
})
it('offers manual search when permission is denied', async () => {
  navigator.mediaDevices.getUserMedia.mockRejectedValue({ name: 'NotAllowedError' })
  const manual = vi.fn()
  render(<ExerciseScanner exercises={[]} onClose={vi.fn()} onManual={manual} />)
  await screen.findByText(/Нет доступа к камере/)
  fireEvent.click(screen.getByText('Найти вручную'))
  expect(manual).toHaveBeenCalledWith('')
})
