// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import ExerciseCard from '../exercises/ExerciseCard.jsx'

let rec
function stubSpeech() {
  vi.stubGlobal('SpeechRecognition', class {
    constructor() { rec = this }
    start = vi.fn()
    abort = vi.fn()
  })
}
afterEach(() => vi.unstubAllGlobals())

const noop = () => {}
const entryOf = (metric, sets) => ({ exercise: { id: 'e1', name: 'Жим лежа', metric }, sets })
function renderCard(entry, props = {}) {
  const onVoiceSet = vi.fn()
  const view = render(
    <ExerciseCard entry={entry} ei={3} prog={null} active
      onReplace={noop} onRemove={noop} onRevertProg={noop} onApplyProg={noop}
      onToggleProgSettings={noop} onChangeProgSettings={noop}
      onUpdateSet={noop} onStep={noop} onAddSet={noop} onRemoveSet={noop}
      onVoiceSet={onVoiceSet} {...props} />,
  )
  return { ...view, onVoiceSet }
}
const say = (...alts) => act(() => rec.onresult({
  results: [Object.assign(alts.map((transcript) => ({ transcript })), { isFinal: true })],
}))
const twoSets = () => entryOf('weight', [{ weight: 60, reps: 10, _k: 'a' }, { weight: 60, reps: 10, _k: 'b' }])

describe('подход голосом в карточке', () => {
  it('нет распознавания — нет микрофона, «+ подход» на месте', () => {
    renderCard(twoSets())
    expect(screen.queryByRole('button', { name: 'Сказать подход голосом' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ подход (повтор предыдущего)' })).toBeInTheDocument()
  })

  it('без onVoiceSet и у «на время» микрофона нет', () => {
    stubSpeech()
    renderCard(twoSets(), { onVoiceSet: null })
    expect(screen.queryByRole('button', { name: 'Сказать подход голосом' })).not.toBeInTheDocument()
    renderCard(entryOf('time', [{ weight: 0, reps: 60, _k: 'a' }]))
    expect(screen.queryByRole('button', { name: 'Сказать подход голосом' })).not.toBeInTheDocument()
  })

  it('показывает строку «было → станет» и пишет только по кнопке', () => {
    stubSpeech()
    const { onVoiceSet } = renderCard(twoSets(), { voiceCursor: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Сказать подход голосом' }))
    expect(rec.lang).toBe('ru-RU')
    expect(rec.maxAlternatives).toBe(3)
    act(() => rec.onaudiostart())
    expect(screen.getByText(/Слушаю/)).toBeInTheDocument()
    say('шестьдесят два с половиной на восемь')
    expect(onVoiceSet).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'В подход 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Подход 2: 60×10 → 62.5×8')
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }))
    expect(onVoiceSet).toHaveBeenCalledExactlyOnceWith(3, 1, { weight: 62.5, reps: 8 })
    expect(screen.queryByText('Распознано')).not.toBeInTheDocument()
  })

  it('выбирает лучший вариант распознавателя и дополняет вес из строки', () => {
    stubSpeech()
    const { onVoiceSet } = renderCard(twoSets())
    fireEvent.click(screen.getByRole('button', { name: 'Сказать подход голосом' }))
    say('жим', '12 раз')
    expect(screen.getByText('«12 раз»')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }))
    expect(onVoiceSet).toHaveBeenCalledExactlyOnceWith(3, 0, { weight: 60, reps: 12 })
  })

  it('можно выбрать другую строку или новую', () => {
    stubSpeech()
    const { onVoiceSet } = renderCard(twoSets())
    fireEvent.click(screen.getByRole('button', { name: 'Сказать подход голосом' }))
    say('70 на 5')
    fireEvent.click(screen.getByRole('button', { name: '+ новый' }))
    expect(screen.getByRole('status')).toHaveTextContent('Новый подход 3: 70×5')
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }))
    expect(onVoiceSet).toHaveBeenCalledExactlyOnceWith(3, 2, { weight: 70, reps: 5 })
  })

  it('номер подхода из фразы; несуществующий подход и непонятное — без кнопки записи', () => {
    stubSpeech()
    renderCard(twoSets())
    const mic = screen.getByRole('button', { name: 'Сказать подход голосом' })
    fireEvent.click(mic)
    say('второй подход 65 на 6')
    expect(screen.getByRole('button', { name: 'В подход 2' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(mic)
    say('пятый подход 65 на 6')
    expect(screen.getByRole('alert')).toHaveTextContent('Подхода 5 нет — сейчас их 2.')
    expect(screen.queryByRole('button', { name: 'Записать' })).not.toBeInTheDocument()
    fireEvent.click(mic)
    say('отличный подход был')
    expect(screen.getByRole('alert')).toHaveTextContent('Не понял вес и повторы')
    fireEvent.click(screen.getByRole('button', { name: 'Отменить подход голосом' }))
    expect(screen.queryByText('Распознано')).not.toBeInTheDocument()
  })

  it('свой вес: помощь гравитрона со знаком', () => {
    stubSpeech()
    const { onVoiceSet } = renderCard(entryOf('reps', [{ weight: 0, reps: 8, _k: 'a' }]))
    fireEvent.click(screen.getByRole('button', { name: 'Сказать подход голосом' }))
    say('минус двадцать на десять')
    expect(screen.getByRole('status')).toHaveTextContent('Подход 1: 8 → −20×10')
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }))
    expect(onVoiceSet).toHaveBeenCalledExactlyOnceWith(3, 0, { weight: -20, reps: 10 })
  })

  it('ошибка микрофона — подсказка про ввод вручную', () => {
    stubSpeech()
    renderCard(twoSets())
    fireEvent.click(screen.getByRole('button', { name: 'Сказать подход голосом' }))
    act(() => rec.onerror({ error: 'language-not-supported' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Введи в строке подхода.')
    expect(rec.abort).toHaveBeenCalledOnce()
  })
})
