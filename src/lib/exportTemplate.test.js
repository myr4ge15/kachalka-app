import { describe, it, expect } from 'vitest'
import {
  cleanTemplateForExport,
  buildTemplatesExport,
  templatesExportFilename,
} from './exportTemplate.js'

// Заготовка шаблона (денормализованный вид, как в Dexie templates).
const tpl = (id, name, exercises = [], extra = {}) => ({
  id, name, user_id: 'u1', is_public: 0, exercises, _dirty: 1, ...extra,
})
const ex = (id, name, target = {}, extra = {}) => ({
  exercise_id: id,
  exercise: { id, name, muscle_group: 'грудь', metric: 'weight', ...extra },
  position: 0,
  sets: target.sets ?? null,
  reps: target.reps ?? null,
  weight: target.weight ?? null,
})

describe('cleanTemplateForExport', () => {
  it('отдаёт имя/видимость/состав без служебных полей синка', () => {
    const out = cleanTemplateForExport(
      tpl('t1', 'День груди', [ex('e1', 'Жим лёжа', { sets: 3, reps: 10, weight: 80 })], { is_public: 1 })
    )
    expect(out).toEqual({
      id: 't1',
      name: 'День груди',
      is_public: true,
      author: null,
      exercises: [{
        exercise: { id: 'e1', name: 'Жим лёжа', muscle_group: 'грудь', metric: 'weight' },
        sets: 3, reps: 10, weight: 80,
      }],
    })
    expect(out._dirty).toBeUndefined()
    expect(out.user_id).toBeUndefined()
  })

  it('легаси-упражнение без целевого плана → null (не дефолты)', () => {
    const out = cleanTemplateForExport(tpl('t1', 'Легаси', [ex('e1', 'Присед')]))
    expect(out.exercises[0]).toMatchObject({ sets: null, reps: null, weight: null })
  })

  it('состав сортируется по position, метрика через exerciseMetric (дефолт weight)', () => {
    const a = { ...ex('e1', 'Первое'), position: 1 }
    const b = { ...ex('e2', 'Нулевое'), position: 0 }
    delete b.exercise.metric // упражнение без metric → 'weight'
    const out = cleanTemplateForExport(tpl('t1', 'Порядок', [a, b]))
    expect(out.exercises.map((e) => e.exercise.name)).toEqual(['Нулевое', 'Первое'])
    expect(out.exercises[0].exercise.metric).toBe('weight')
  })

  it('чужой общий шаблон сохраняет автора; битое упражнение не роняет экспорт', () => {
    const broken = { exercise_id: 'e9', exercise: null, position: 0 }
    const out = cleanTemplateForExport(
      tpl('t1', 'Чужой', [broken], { user_id: 'u2', author_name: 'Вася' })
    )
    expect(out.author).toBe('Вася')
    expect(out.exercises[0].exercise).toEqual({
      id: 'e9', name: '—', muscle_group: null, metric: 'weight',
    })
  })
})

describe('buildTemplatesExport', () => {
  it('конверт: schema/версия/дата/количество; принимает и один шаблон', () => {
    const now = new Date('2026-07-09T10:00:00Z')
    const out = buildTemplatesExport(tpl('t1', 'Один'), '3.11.0', now)
    expect(out.schema).toBe('templates-export/v1')
    expect(out.app_version).toBe('3.11.0')
    expect(out.exported_at).toBe('2026-07-09T10:00:00.000Z')
    expect(out.count).toBe(1)
    expect(out.templates).toHaveLength(1)
  })

  it('битая дата → exported_at: null', () => {
    expect(buildTemplatesExport([], 'dev', new Date('нет')).exported_at).toBe(null)
  })
})

describe('templatesExportFilename', () => {
  const now = new Date('2026-07-09T10:00:00Z')
  it('один шаблон → template-дата, несколько → templates-N-дата', () => {
    expect(templatesExportFilename(tpl('t1', 'Один'), now)).toBe('template-2026-07-09.json')
    expect(templatesExportFilename([tpl('t1', 'a'), tpl('t2', 'b')], now))
      .toBe('templates-2-2026-07-09.json')
  })
})
