import { describe, it, expect } from 'vitest'
import {
  BACKUP_SCHEMA, BackupError, buildBackup, backupFilename,
  parseBackup, assertSameOwner, planImport, describeImport,
} from './backup.js'

const workouts = [
  {
    id: 'w1', user_id: 'u1', performed_at: '2026-01-10', created_at: '2026-01-09',
    updated_at: '2026-01-11', _dirty: 1, _deleted: 0,
    entries: [
      { exercise: { id: 'ex1', name: 'Жим', muscle_group: 'грудь', metric: 'weight' }, sets: [{ weight: 100, reps: 5 }] },
      { exercise: { id: 'ex2', name: 'Планка', muscle_group: 'пресс', metric: 'time' }, sets: [{ weight: 0, reps: 60 }] },
    ],
  },
]
const goals = [
  { exerciseId: 'ex1', exerciseName: 'Жим', metric: 'weight', targetWeight: 120, targetReps: 3, achievedAt: null, _dirty: 1 },
  { exerciseId: 'ex9', exerciseName: 'Удалённая', metric: 'weight', targetWeight: 50, _deleted: 1, _dirty: 1 },
]
const badges = { reg_1: { at: '2026-01-01T00:00:00.000Z', backfilled: false } }

const snap = () =>
  buildBackup(
    { userId: 'u1', userName: 'Андрей', workouts, goals, badges, prog: { enabled: false, byExercise: { ex1: { step: 2.5 } } }, priv: true },
    '5.1.0',
    new Date('2026-07-24T10:00:00.000Z')
  )

describe('buildBackup', () => {
  it('собирает конверт со схемой, владельцем и счётчиками', () => {
    const b = snap()
    expect(b.schema).toBe(BACKUP_SCHEMA)
    expect(b.app_version).toBe('5.1.0')
    expect(b.exported_at).toBe('2026-07-24T10:00:00.000Z')
    expect(b.user).toEqual({ id: 'u1', name: 'Андрей' })
    expect(b.counts).toEqual({ workouts: 1, goals: 1, badges: 1 })
  })

  it('тренировки чистятся тем же чистильщиком: без служебных полей синка', () => {
    const w = snap().workouts[0]
    expect(w).not.toHaveProperty('_dirty')
    expect(w).not.toHaveProperty('user_id')
    expect(w.entries[1].sets).toEqual([{ weight: 0, reps: 60 }]) // time: секунды в reps
  })

  it('цели: без tombstone-ов и без _dirty; приватность — справочно', () => {
    const b = snap()
    expect(b.goals).toEqual([
      { exerciseId: 'ex1', exerciseName: 'Жим', metric: 'weight', targetWeight: 120, targetReps: 3, achievedAt: null },
    ])
    expect(b.settings.is_private).toBe(true)
    expect(b.settings.progression).toEqual({ enabled: false, byExercise: { ex1: { step: 2.5 } } })
  })

  it('пустое состояние не роняет сборку', () => {
    const b = buildBackup({}, 'dev', new Date('2026-07-24'))
    expect(b.workouts).toEqual([])
    expect(b.goals).toEqual([])
    expect(b.badges).toEqual({})
    expect(b.counts).toEqual({ workouts: 0, goals: 0, badges: 0 })
  })

  it('битая дата → exported_at null', () => {
    expect(buildBackup({}, 'dev', new Date('нет')).exported_at).toBe(null)
  })
})

describe('backupFilename', () => {
  it('backup-YYYY-MM-DD.json', () => {
    expect(backupFilename(new Date('2026-07-24T10:00:00.000Z'))).toBe('backup-2026-07-24.json')
    expect(backupFilename(new Date('нет'))).toBe('backup-export.json')
  })
})

describe('parseBackup', () => {
  it('разбирает свой файл', () => {
    expect(parseBackup(JSON.stringify(snap())).schema).toBe(BACKUP_SCHEMA)
  })

  it('не JSON / не объект / не та схема → BackupError с подсказкой', () => {
    expect(() => parseBackup('<html>')).toThrow(BackupError)
    expect(() => parseBackup('[1,2]')).toThrow(/не похож/)
    expect(() => parseBackup('{}')).toThrow(/полного бэкапа/)
    expect(() => parseBackup(JSON.stringify({ schema: 'workouts-export/v1' }))).toThrow(/выгрузка тренировок/)
    expect(() => parseBackup(JSON.stringify({ schema: 'templates-export/v1' }))).toThrow(/выгрузка шаблонов/)
  })
})

describe('assertSameOwner', () => {
  it('свой файл проходит, чужой — нет', () => {
    expect(() => assertSameOwner(snap(), 'u1')).not.toThrow()
    expect(() => assertSameOwner(snap(), 'u2')).toThrow(/другому пользователю \(Андрей\)/)
  })

  it('снимок без владельца пропускаем (сверять не с чем)', () => {
    expect(() => assertSameOwner({ user: { id: null } }, 'u1')).not.toThrow()
    expect(() => assertSameOwner({}, 'u1')).not.toThrow()
  })
})

describe('planImport', () => {
  const exercises = new Map([
    ['ex1', { id: 'ex1', name: 'Жим лёжа', muscle_group: 'грудь', submuscle: 'грудь_верх', secondary: ['трицепс'], is_bench_lift: true, metric: 'weight' }],
  ])

  it('пустая база: добавляет всё, упражнение берёт из локального справочника', () => {
    const p = planImport(snap(), { workoutIds: [], goals: [], badges: {}, prog: undefined, exercises })
    expect(p.counts).toEqual({ workouts: 1, workoutsSkipped: 0, goals: 1, badges: 1, prog: 1 })
    // полная форма из справочника, а не усечённая из файла
    expect(p.workouts[0].entries[0].exercise.is_bench_lift).toBe(true)
    expect(p.workouts[0].entries[0].exercise.secondary).toEqual(['трицепс'])
    // упражнения нет локально → фолбэк на снимок
    expect(p.workouts[0].entries[1].exercise).toEqual({ id: 'ex2', name: 'Планка', muscle_group: 'пресс', metric: 'time' })
    expect(p.workouts[0].id).toBe('w1')
  })

  it('идемпотентность: повторный импорт того же файла ничего не добавляет', () => {
    const b = snap()
    const cur = { workoutIds: ['w1'], goals, badges, prog: { enabled: false, byExercise: { ex1: { step: 2.5 } } }, exercises }
    const p = planImport(b, cur)
    expect(p.counts).toEqual({ workouts: 0, workoutsSkipped: 0, goals: 0, badges: 0, prog: 0 })
    expect(p.goals).toBe(null)
    expect(p.badges).toBe(null)
    expect(p.prog).toBe(null)
  })

  it('ничего не перезаписывает: существующая тренировка и цель остаются как есть', () => {
    const b = snap()
    b.workouts[0].entries[0].sets = [{ weight: 999, reps: 99 }] // «испорченный» старый файл
    const p = planImport(b, { workoutIds: ['w1'], goals, badges: {}, exercises })
    expect(p.workouts).toEqual([])
    expect(p.goals).toBe(null) // цель на ex1 уже есть — не трогаем
  })

  it('удалённую цель не воскрешает (tombstone занимает exerciseId)', () => {
    const b = snap()
    b.goals.push({ exerciseId: 'ex9', exerciseName: 'Удалённая', metric: 'weight', targetWeight: 50, achievedAt: null })
    const p = planImport(b, { workoutIds: [], goals, badges: {}, exercises })
    expect(p.goals).toBe(null)
  })

  it('добавленная цель помечается _dirty, чтобы уехать на сервер', () => {
    const b = snap()
    const p = planImport(b, { workoutIds: [], goals: [], badges: {}, exercises })
    expect(p.goals[0]).toMatchObject({ exerciseId: 'ex1', targetWeight: 120, targetReps: 3, _dirty: 1 })
  })

  it('восстановленные бейджи помечаются backfilled (не спамят колокольчик)', () => {
    const p = planImport(snap(), { workoutIds: [], goals: [], badges: {}, exercises })
    expect(p.badges).toEqual({ reg_1: { at: '2026-01-01T00:00:00.000Z', backfilled: true } })
  })

  it('бейдж без даты игнорируется', () => {
    const b = snap()
    b.badges = { reg_1: { at: null }, reg_10: 'мусор' }
    expect(planImport(b, { workoutIds: [], goals: [], badges: {}, exercises }).badges).toBe(null)
  })

  it('тренировка без id или без валидных подходов пропускается', () => {
    const b = snap()
    b.workouts = [
      { id: null, entries: [{ exercise: { id: 'ex1' }, sets: [{ weight: 50, reps: 5 }] }] },
      { id: 'w2', entries: [{ exercise: { id: 'ex1' }, sets: [{ weight: 0, reps: 0 }] }] },
      { id: 'w3', entries: [{ sets: [{ weight: 50, reps: 5 }] }] }, // нет id упражнения
      { id: 'w4', entries: [] },
    ]
    const p = planImport(b, { workoutIds: [], goals: [], badges: {}, exercises })
    expect(p.workouts).toEqual([])
    expect(p.counts.workoutsSkipped).toBe(4)
  })

  it('упражнение без веса: подход 0×повторы сохраняется (не считается пустым)', () => {
    const b = snap()
    b.workouts = [{ id: 'w5', performed_at: '2026-02-01', entries: [{ exercise: { id: 'ex2', name: 'Планка', metric: 'time' }, sets: [{ weight: 0, reps: 45 }] }] }]
    const p = planImport(b, { workoutIds: [], goals: [], badges: {}, exercises })
    expect(p.workouts[0].entries[0].sets).toEqual([{ weight: 0, reps: 45 }])
  })

  it('прогрессия: тумблер пользователя не перетирается, новые упражнения добавляются', () => {
    const b = snap() // в файле enabled:false, byExercise.ex1
    const p = planImport(b, {
      workoutIds: [], goals: [], badges: {},
      prog: { enabled: true, byExercise: { ex7: { step: 5 } } },
      exercises,
    })
    expect(p.prog).toEqual({ enabled: true, byExercise: { ex7: { step: 5 }, ex1: { step: 2.5 } } })
  })

  it('прогрессия: если настроек не было вовсе — берём тумблер из файла', () => {
    const p = planImport(snap(), { workoutIds: [], goals: [], badges: {}, prog: undefined, exercises })
    expect(p.prog).toEqual({ enabled: false, byExercise: { ex1: { step: 2.5 } } })
  })

  it('настройки прогрессии в файле пустые → трогать нечего', () => {
    const b = snap()
    b.settings.progression = null
    expect(planImport(b, { workoutIds: [], goals: [], badges: {}, prog: { enabled: true, byExercise: {} }, exercises }).prog).toBe(null)
  })

  it('пустой current и пустой снимок не роняют план', () => {
    const p = planImport({ workouts: [], goals: [], badges: {} }, {})
    expect(p.counts).toEqual({ workouts: 0, workoutsSkipped: 0, goals: 0, badges: 0, prog: 0 })
    expect(planImport(undefined, undefined).workouts).toEqual([])
  })

  it('exercises можно передать обычным объектом, не только Map', () => {
    const p = planImport(snap(), { workoutIds: [], goals: [], badges: {}, exercises: { ex1: { id: 'ex1', name: 'Жим лёжа', is_bench_lift: true } } })
    expect(p.workouts[0].entries[0].exercise.name).toBe('Жим лёжа')
  })
})

describe('describeImport', () => {
  it('перечисляет только непустое', () => {
    expect(describeImport({ workouts: 3, goals: 0, badges: 2, prog: 1 }))
      .toBe('Добавлено — тренировок: 3, достижений: 2, настройки прогрессии.')
  })
  it('нечего добавлять → понятный текст', () => {
    expect(describeImport({ workouts: 0, goals: 0, badges: 0, prog: 0 })).toBe('Всё из файла уже было в приложении.')
    expect(describeImport(undefined)).toBe('Всё из файла уже было в приложении.')
  })
})
