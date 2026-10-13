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
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) }) })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1280 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 720 })
  worker = { terminate: vi.fn(), setParameters: vi.fn().mockResolvedValue(), recognize: vi.fn().mockResolvedValue({ data: { text: 'LAT PULLDOWN', confidence: 95 } }) }
  createScannerWorker.mockResolvedValue(worker)
})
afterEach(() => vi.restoreAllMocks())
it('never picks automatically; stops camera on stable result and offers the best match', async () => {
  const onPick = vi.fn()
  render(<ExerciseScanner exercises={exercises} onPick={onPick} onClose={vi.fn()} onManual={vi.fn()} />)
  await screen.findByRole('button', { name: 'Добавить в тренировку' }, { timeout: 4000 })
  expect(stop).toHaveBeenCalled()
  expect(worker.terminate).toHaveBeenCalled()
  expect(onPick).not.toHaveBeenCalled()
  expect(screen.getByRole('heading', { name: 'Тяга верхнего блока' })).toBeInTheDocument()
  expect(screen.queryByText('Ещё на табличке')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Добавить в тренировку' }))
  expect(onPick).toHaveBeenCalledWith(exercises[0])
})
it('lists other movements from the same plate; one tap picks', async () => {
  const calf = [{ id: 'stand', name: 'Подъем на носки стоя', muscle_group: 'ноги' }, { id: 'sit', name: 'Подъем на носки сидя', muscle_group: 'ноги' }]
  worker.recognize.mockResolvedValue({ data: { text: 'CALF RAISE', confidence: 90 } })
  const onPick = vi.fn()
  render(<ExerciseScanner exercises={calf} onPick={onPick} onClose={vi.fn()} onManual={vi.fn()} />)
  await screen.findByText('Ещё на табличке', {}, { timeout: 4000 })
  expect(screen.getByRole('heading', { name: 'Подъем на носки сидя' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Подъем на носки стоя/ }))
  expect(onPick).toHaveBeenCalledWith(calf[0])
})
it('picks the current candidate from the status badge without waiting for confirmation', async () => {
  worker.recognize.mockResolvedValueOnce({ data: { text: 'LAT PULLDOWN', confidence: 95 } })
    .mockReturnValue(new Promise(() => {})) // the second read never comes back
  const onPick = vi.fn()
  render(<ExerciseScanner exercises={exercises} onPick={onPick} onClose={vi.fn()} onManual={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /Похоже на Тяга верхнего блока/ }))
  expect(onPick).toHaveBeenCalledWith(exercises[0])
})
it('shows the torch only when the camera has one and toggles it', async () => {
  const applyConstraints = vi.fn().mockResolvedValue()
  const camera = { stop, getCapabilities: () => ({ torch: true }), applyConstraints }
  navigator.mediaDevices.getUserMedia.mockResolvedValue({ getTracks: () => [camera], getVideoTracks: () => [camera] })
  worker.recognize.mockReturnValue(new Promise(() => {}))
  render(<ExerciseScanner exercises={exercises} onClose={vi.fn()} onManual={vi.fn()} />)
  const torch = await screen.findByRole('button', { name: 'Фонарик' })
  expect(torch).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(torch)
  await waitFor(() => expect(torch).toHaveAttribute('aria-pressed', 'true'))
  expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] })
  applyConstraints.mockRejectedValue(new Error('busy'))
  fireEvent.click(torch)
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Фонарик' })).not.toBeInTheDocument())
})
it('has no torch button without the capability', async () => {
  worker.recognize.mockReturnValue(new Promise(() => {}))
  render(<ExerciseScanner exercises={exercises} onClose={vi.fn()} onManual={vi.fn()} />)
  await screen.findByText('Ищу название…')
  expect(screen.queryByRole('button', { name: 'Фонарик' })).not.toBeInTheDocument()
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
it('does not run OCR on a covered camera', async () => {
  HTMLCanvasElement.prototype.getContext.mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(40) }) })
  render(<ExerciseScanner exercises={exercises} onClose={vi.fn()} onManual={vi.fn()} />)
  await screen.findByText(/Не видно надписи/)
  expect(worker.recognize).not.toHaveBeenCalled()
})
it('does not display or copy raw OCR garbage into manual search', async () => {
  worker.recognize.mockResolvedValue({ data: { text: 'B eo PB E junk unreadable', confidence: 10 } })
  const manual = vi.fn()
  render(<ExerciseScanner exercises={exercises} onClose={vi.fn()} onManual={manual} />)
  await screen.findByText(/Не узнал/)
  expect(screen.queryByText(/junk unreadable/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Найти вручную'))
  expect(manual).toHaveBeenCalledWith('')
})
