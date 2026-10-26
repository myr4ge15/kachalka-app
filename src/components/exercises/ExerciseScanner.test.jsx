// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import ExerciseScanner from './ExerciseScanner.jsx'
import { createScannerWorker } from '../../services/scannerOcr.js'
vi.mock('../../services/scannerOcr.js', () => ({ createScannerWorker: vi.fn() }))
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
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
// Распознавание повторяется раз в 1,2 с, стабильный результат — со второго чтения: на настоящих часах
// 8 тестов ниже ждали ~12 с (самый долгий файл набора, 26.10.2026). Подделываем только setTimeout (поллинг
// RTL на setInterval и MutationObserver остается настоящим) и двигаем часы шагами, пока элемент не появится.
const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
async function untilShown(query, maxMs = 10_000) {
  for (let t = 0; t <= maxMs; t += 100) {
    const el = query()
    if (el) return el
    await act(() => vi.advanceTimersByTimeAsync(100))
  }
  throw new Error(`за ${maxMs} мс по часам теста элемент не появился`)
}
const byRole = (name) => () => screen.queryByRole('button', { name })
it('never picks automatically; stops camera on stable result and offers the best match', async () => {
  fakeClock()
  const onPick = vi.fn()
  render(<ExerciseScanner exercises={exercises} onPick={onPick} onClose={vi.fn()} onManual={vi.fn()} />)
  await untilShown(byRole('Добавить в тренировку'))
  expect(stop).toHaveBeenCalled()
  expect(worker.terminate).toHaveBeenCalled()
  expect(onPick).not.toHaveBeenCalled()
  expect(screen.getByRole('heading', { name: 'Тяга верхнего блока' })).toBeInTheDocument()
  expect(screen.queryByText('Еще на табличке')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Добавить в тренировку' }))
  expect(onPick).toHaveBeenCalledWith(exercises[0])
})
it('замена упражнения: главная кнопка — «Заменить» (UI-ревью 23.10)', async () => {
  fakeClock()
  const onPick = vi.fn()
  render(<ExerciseScanner exercises={exercises} onPick={onPick} onClose={vi.fn()} onManual={vi.fn()} replacing />)
  fireEvent.click(await untilShown(byRole('Заменить')))
  expect(onPick).toHaveBeenCalledWith(exercises[0])
  expect(screen.queryByRole('button', { name: 'Добавить в тренировку' })).toBeNull()
})
it('lists other movements from the same plate; one tap picks', async () => {
  fakeClock()
  const calf = [{ id: 'stand', name: 'Подъем на носки стоя', muscle_group: 'ноги' }, { id: 'sit', name: 'Подъем на носки сидя', muscle_group: 'ноги' }]
  worker.recognize.mockResolvedValue({ data: { text: 'CALF RAISE', confidence: 90 } })
  const onPick = vi.fn()
  render(<ExerciseScanner exercises={calf} onPick={onPick} onClose={vi.fn()} onManual={vi.fn()} />)
  await untilShown(() => screen.queryByText('Еще на табличке'))
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
it('does not flash the long "preparing" status when recognition loads fast', async () => {
  createScannerWorker.mockImplementation(() => new Promise(r => setTimeout(() => r(worker), 150))) // cached, like on a phone
  worker.recognize.mockReturnValue(new Promise(() => {}))
  const seen = new Set()
  const observer = new MutationObserver(() => seen.add(document.body.textContent))
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  // Снимаем и при падении: живой наблюдатель стрелял после закрытия jsdom (аудит 16.10, 🟢-8).
  try {
    render(<ExerciseScanner exercises={exercises} onClose={vi.fn()} onManual={vi.fn()} />)
    await screen.findByText('Ищу название…')
  } finally {
    observer.disconnect()
  }
  expect([...seen].some(t => t.includes('Готовлю распознавание'))).toBe(false)
})
it('explains a slow first load of recognition', async () => {
  fakeClock()
  createScannerWorker.mockReturnValue(new Promise(() => {}))
  render(<ExerciseScanner exercises={exercises} onClose={vi.fn()} onManual={vi.fn()} />)
  expect(await untilShown(() => screen.queryByText('Запускаем камеру…'))).toBeInTheDocument()
  expect(await untilShown(() => screen.queryByText(/Готовлю распознавание/))).toBeInTheDocument()
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
it('iPhone с тройной камерой: переоткрывает основной объектив и гасит виртуальную', async () => {
  const virtual = { stop: vi.fn(), getSettings: () => ({ deviceId: 't' }) }
  const main = { stop: vi.fn(), getSettings: () => ({ deviceId: 'm' }) }
  navigator.mediaDevices.getUserMedia
    .mockResolvedValueOnce({ getTracks: () => [virtual], getVideoTracks: () => [virtual] })
    .mockResolvedValueOnce({ getTracks: () => [main], getVideoTracks: () => [main] })
  navigator.mediaDevices.enumerateDevices = vi.fn().mockResolvedValue([
    { kind: 'videoinput', deviceId: 't', label: 'Задняя тройная камера' },
    { kind: 'videoinput', deviceId: 'm', label: 'Задняя камера' },
  ])
  worker.recognize.mockReturnValue(new Promise(() => {}))
  render(<ExerciseScanner exercises={exercises} onClose={vi.fn()} onManual={vi.fn()} />)
  await screen.findByText('Ищу название…')
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith(expect.objectContaining({
    video: expect.objectContaining({ deviceId: { exact: 'm' } }),
  }))
  expect(virtual.stop).toHaveBeenCalled()
  expect(main.stop).not.toHaveBeenCalled()
})
it('основную камеру открыть не дали — сканер работает на камере по умолчанию', async () => {
  const virtual = { stop: vi.fn(), getSettings: () => ({ deviceId: 't' }) }
  navigator.mediaDevices.getUserMedia
    .mockResolvedValueOnce({ getTracks: () => [virtual], getVideoTracks: () => [virtual] })
    .mockRejectedValueOnce({ name: 'OverconstrainedError' })
  navigator.mediaDevices.enumerateDevices = vi.fn().mockResolvedValue([
    { kind: 'videoinput', deviceId: 't', label: 'Back Triple Camera' },
    { kind: 'videoinput', deviceId: 'm', label: 'Back Camera' },
  ])
  worker.recognize.mockReturnValue(new Promise(() => {}))
  render(<ExerciseScanner exercises={exercises} onClose={vi.fn()} onManual={vi.fn()} />)
  await screen.findByText('Ищу название…')
  expect(virtual.stop).not.toHaveBeenCalled()
})

// ---- Набор сканером (8.4.0) ----
const calfPair = [{ id: 'stand', name: 'Подъем на носки стоя', muscle_group: 'ноги' }, { id: 'sit', name: 'Подъем на носки сидя', muscle_group: 'ноги' }]
const box = name => screen.getByRole('checkbox', { name: new RegExp(name) })
it('набор: найденное ложится в шторку, сканер не останавливается, «Готово · N» отдает все по порядку', async () => {
  fakeClock()
  const all = [...exercises, ...calfPair]
  worker.recognize
    .mockResolvedValueOnce({ data: { text: 'LAT PULLDOWN', confidence: 95 } })
    .mockResolvedValueOnce({ data: { text: 'LAT PULLDOWN', confidence: 95 } })
    .mockResolvedValueOnce({ data: { text: 'LAT PULLDOWN', confidence: 95 } }) // та же табличка — не дублируем
    .mockResolvedValueOnce({ data: { text: 'CALF RAISE', confidence: 90 } })
    .mockResolvedValueOnce({ data: { text: 'CALF RAISE', confidence: 90 } })
    .mockReturnValue(new Promise(() => {}))
  const onPick = vi.fn(), onPickMany = vi.fn()
  render(<ExerciseScanner exercises={all} onPick={onPick} onPickMany={onPickMany} onClose={vi.fn()} onManual={vi.fn()} />)
  await untilShown(byRole('Готово · 1'))
  expect(stop).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /Найти вручную/ })).not.toBeInTheDocument()
  await untilShown(byRole('Готово · 2'))
  // Свернуто: видно последнее найденное, остальные — «еще 1»; раскрытие — весь список.
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  expect(box('Подъем на носки сидя')).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: /Еще 1 в списке/ }))
  expect(screen.getByRole('group', { name: 'Набрано сканером' })).toBeInTheDocument()
  expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }))
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Готово · 2' }))
  expect(onPickMany).toHaveBeenCalledWith([exercises[0], calfPair[1]])
  expect(onPick).not.toHaveBeenCalled()
})
it('набор: свайп вверх раскрывает шторку, вниз — сворачивает; свайп по строке не снимает галочку', async () => {
  fakeClock()
  const all = [...exercises, ...calfPair]
  worker.recognize
    .mockResolvedValueOnce({ data: { text: 'LAT PULLDOWN', confidence: 95 } })
    .mockResolvedValueOnce({ data: { text: 'LAT PULLDOWN', confidence: 95 } })
    .mockResolvedValueOnce({ data: { text: 'CALF RAISE', confidence: 90 } })
    .mockResolvedValueOnce({ data: { text: 'CALF RAISE', confidence: 90 } })
    .mockReturnValue(new Promise(() => {}))
  render(<ExerciseScanner exercises={all} onPick={vi.fn()} onPickMany={vi.fn()} onClose={vi.fn()} onManual={vi.fn()} />)
  await untilShown(byRole('Готово · 2'))
  const sheet = screen.getByRole('region', { name: 'Список на тренировку' })
  const swipe = (el, from, to) => {
    fireEvent.touchStart(el, { touches: [{ clientY: from }] })
    fireEvent.touchEnd(el, { changedTouches: [{ clientY: to }] })
  }
  const row = box('Подъем на носки сидя').closest('label')
  swipe(row, 500, 380)
  fireEvent.click(row) // клик, который браузер шлет после свайпа, — не нажатие
  expect(box('Подъем на носки сидя')).toBeChecked()
  expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  swipe(sheet, 300, 320) // короткий сдвиг — не свайп
  expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  swipe(screen.getByText(/В списке/), 300, 420)
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  fireEvent.touchStart(box('Подъем на носки сидя'), { touches: [{ clientY: 500 }] })
  fireEvent.click(box('Подъем на носки сидя')) // обычный тап после свайпа работает
  expect(box('Подъем на носки сидя')).not.toBeChecked()
})
it('набор: «Заменить на …» меняет последнее найденное; снятая галочка не уходит в «Готово»', async () => {
  fakeClock()
  worker.recognize.mockResolvedValueOnce({ data: { text: 'CALF RAISE', confidence: 90 } })
    .mockResolvedValueOnce({ data: { text: 'CALF RAISE', confidence: 90 } })
    .mockReturnValue(new Promise(() => {}))
  const onPickMany = vi.fn()
  render(<ExerciseScanner exercises={calfPair} onPick={vi.fn()} onPickMany={onPickMany} onClose={vi.fn()} onManual={vi.fn()} />)
  await untilShown(byRole('Готово · 1'))
  fireEvent.click(screen.getByRole('button', { name: 'Заменить на «Подъем на носки стоя»' }))
  expect(box('Подъем на носки стоя')).toBeChecked()
  expect(screen.queryByRole('checkbox', { name: /Подъем на носки сидя/ })).not.toBeInTheDocument()
  fireEvent.click(box('Подъем на носки стоя'))
  expect(box('Подъем на носки стоя')).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Ничего не отмечено' })).toBeDisabled()
  fireEvent.click(box('Подъем на носки стоя'))
  fireEvent.click(screen.getByRole('button', { name: 'Готово · 1' }))
  expect(onPickMany).toHaveBeenCalledWith([calfPair[0]])
})
it('набор: бейдж кандидата добавляет в шторку, а не закрывает сканер', async () => {
  worker.recognize.mockResolvedValueOnce({ data: { text: 'LAT PULLDOWN', confidence: 95 } })
    .mockReturnValue(new Promise(() => {}))
  const onPick = vi.fn()
  render(<ExerciseScanner exercises={exercises} onPick={onPick} onPickMany={vi.fn()} onClose={vi.fn()} onManual={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /Похоже на Тяга верхнего блока/ }))
  expect(onPick).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Готово · 1' })).toBeInTheDocument()
  expect(screen.getByText(/уже в списке/)).toBeInTheDocument()
})
it('набор: «назад» с отмеченными спрашивает — добавить, закрыть без них или сканировать дальше', async () => {
  worker.recognize.mockResolvedValueOnce({ data: { text: 'LAT PULLDOWN', confidence: 95 } })
    .mockReturnValue(new Promise(() => {}))
  const onClose = vi.fn(), onPickMany = vi.fn()
  render(<ExerciseScanner exercises={exercises} onPick={vi.fn()} onPickMany={onPickMany} onClose={onClose} onManual={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /Похоже на Тяга верхнего блока/ }))
  fireEvent.click(screen.getByRole('button', { name: 'назад' }))
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('alertdialog', { name: 'Добавить найденное?' })).toHaveTextContent('В списке 1 упражнение')
  fireEvent.click(screen.getByRole('button', { name: 'Сканировать дальше' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'назад' }))
  fireEvent.click(screen.getByRole('button', { name: 'Добавить 1 упражнение' }))
  expect(onPickMany).toHaveBeenCalledWith([exercises[0]])
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть без них' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})
it('шум вокруг таблички: уверенная строка распознается, даже если средняя уверенность кадра низкая', async () => {
  fakeClock()
  const blocks = [{ paragraphs: [{ lines: [{ text: 'LAT PULLDOWN', confidence: 67 }, { text: 'Bx 0O ~~', confidence: 8 }] }] }]
  worker.recognize.mockResolvedValue({ data: { text: 'LAT PULLDOWN\nBx 0O ~~', confidence: 38, blocks } })
  render(<ExerciseScanner exercises={exercises} onPick={vi.fn()} onClose={vi.fn()} onManual={vi.fn()} />)
  await untilShown(byRole('Добавить в тренировку'))
  expect(worker.recognize).toHaveBeenCalledWith(expect.anything(), {}, { blocks: true })
})
