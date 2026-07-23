import { describe, it, expect } from 'vitest'
import { pickSaveCelebration } from './saveCelebration.js'

// Чистый выбор поздравительного тоста после сохранения (вырезано из
// WorkoutScreen.save). Проверяем приоритет показа, формат payload'а и флаг
// «праздничной» вибрации (celebrated).

const pr = (over = {}) => ({ name: 'Жим', metric: 'weight', value: 100, prev: 90, ...over })
const goal = (over = {}) => ({ name: 'Жим', metric: 'weight', value: 100, reps: null, ...over })
const badge = (over = {}) => ({ icon: '🌱', name: 'Первый шаг', ...over })
const insight = (over = {}) => ({ emoji: '📈', text: 'Объём растёт', ...over })

describe('pickSaveCelebration', () => {
  it('ничего не сработало → тоста нет, вибрация обычная', () => {
    expect(pickSaveCelebration({})).toEqual({ celebrated: false, toast: null })
  })

  it('рекорд: заголовок и «было», celebrated=true', () => {
    const { celebrated, toast } = pickSaveCelebration({ prs: [pr()] })
    expect(celebrated).toBe(true)
    expect(toast.title).toBe('Новый рекорд!')
    expect(toast.sub).toBe('Жим — 100 кг (было 90 кг)')
  })

  it('рекорд: несколько → суффикс +N по самому большому value', () => {
    const { toast } = pickSaveCelebration({ prs: [pr({ value: 100 }), pr({ name: 'Тяга', value: 150, prev: 140 })] })
    expect(toast.sub).toBe('Тяга — 150 кг (было 140 кг) +1')
  })

  it('цель ПЕРЕБИВАЕТ рекорд (даже если оба сработали)', () => {
    const { toast, celebrated } = pickSaveCelebration({ prs: [pr()], reached: [goal()] })
    expect(celebrated).toBe(true)
    expect(toast.emoji).toBe('🎯')
    expect(toast.title).toBe('Цель достигнута!')
  })

  it('цель «вес × повторы» → показывает × N', () => {
    const { toast } = pickSaveCelebration({ reached: [goal({ reps: 5 })] })
    expect(toast.sub).toBe('Жим — 100 кг × 5')
  })

  it('цель без повторов → без × N', () => {
    const { toast } = pickSaveCelebration({ reached: [goal({ reps: null })] })
    expect(toast.sub).toBe('Жим — 100 кг')
  })

  it('несколько целей → множественный заголовок и +N', () => {
    const { toast } = pickSaveCelebration({ reached: [goal({ value: 100 }), goal({ name: 'Присед', value: 200 })] })
    expect(toast.title).toBe('Цели достигнуты!')
    expect(toast.sub).toBe('Присед — 200 кг +1')
  })

  it('бейдж показывается только когда нет рекорда/цели', () => {
    const { toast, celebrated } = pickSaveCelebration({ newBadges: [badge()] })
    expect(celebrated).toBe(true)
    expect(toast.emoji).toBe('🏆')
    expect(toast.title).toBe('Новое достижение!')
    expect(toast.sub).toBe('🌱 Первый шаг')
  })

  it('бейдж НЕ перебивает рекорд', () => {
    const { toast } = pickSaveCelebration({ prs: [pr()], newBadges: [badge()] })
    expect(toast.title).toBe('Новый рекорд!')
  })

  it('несколько бейджей → множественный заголовок и +N', () => {
    const { toast } = pickSaveCelebration({ newBadges: [badge(), badge({ name: '10 тренировок' })] })
    expect(toast.title).toBe('Новые достижения!')
    expect(toast.sub).toBe('🌱 Первый шаг +1')
  })

  it('инсайт: тост есть, но вибрация ОБЫЧНАЯ (celebrated=false)', () => {
    const { toast, celebrated } = pickSaveCelebration({ insights: [insight()] })
    expect(celebrated).toBe(false)
    expect(toast).toMatchObject({ emoji: '📈', title: 'Вывод после тренировки', sub: 'Объём растёт' })
  })

  it('инсайт НЕ показывается, если сработал бейдж', () => {
    const { toast } = pickSaveCelebration({ newBadges: [badge()], insights: [insight()] })
    expect(toast.emoji).toBe('🏆')
  })
})
