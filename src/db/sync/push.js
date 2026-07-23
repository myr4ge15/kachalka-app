// ============================================================================
// Синхронизация — стадия PUSH. Отправляем локальные очереди (outbox) на сервер
// через RPC/таблицы. Вынесено из sync.js (техдолг «разбить sync.js на pull/push»).
// Здесь: единый прогон очереди runOutbox (общая политика повторов/dead-letter) +
// pushExercises / pushTemplates / push (тренировки) / pushReactions / pushGoal.
//
// Стадию PULL см. в ./pull.js; наблюдаемое состояние, syncNow и жизненный цикл —
// в ../sync.js. ПОВЕДЕНИЕ НЕ МЕНЯЛОСЬ — чистый перенос кода с правкой относительных
// путей импорта (модуль стал на уровень глубже: '../lib' → '../../lib' и т.д.).
//
// Порядок отправки важен из-за FK: упражнения (ex_outbox) и шаблоны (tpl_outbox)
// уходят РАНЬШЕ тренировок (outbox, FK на exercise_id), реакции — ПОСЛЕ (FK на
// workout). Оркеструет порядок syncNow (../sync.js), здесь — только сами прогоны.
// ============================================================================
import { supabase } from '../supabase.js'
import { withTimeout } from '../../lib/withTimeout.js'
import { db } from '../local.js'
import { readGoals, writeGoals } from '../notifications.js'
import { normMetric } from '../../lib/metric.js'

// После стольких неудачных попыток операция считается «отравленной» и
// откладывается в dead-letter (флаг _dead): она больше не блокирует очередь,
// но остаётся в базе для диагностики. Иначе один битый upsert вешал синк навсегда.
const MAX_ATTEMPTS = 5

// Единый прогон очереди outbox с общей политикой повторов/dead-letter (раньше
// этот блок был скопирован в 4 push-циклах, РЕВЬЮ-КОДА-2026-07-13). Идём по seq;
// `handler(op)` делает работу и САМ удаляет операцию на успехе (успех = не бросил).
//   - table — Dexie-таблица очереди (ex_outbox/tpl_outbox/outbox/reaction_outbox);
//   - deadLetter=true (тренировки/упражнения/шаблоны): _dead-операции пропускаем;
//     на ошибке растим attempts, после MAX помечаем `_dead` и идём дальше (не
//     вешаем очередь), иначе БРОСАЕМ — прекращаем проход, сохраняя порядок;
//   - deadLetter=false (реакции, низкий приоритет): без _dead-флага и без throw —
//     после MAX попыток операцию просто выбрасываем, очередь не блокируем.
// Экспортируется для unit-теста (sync.test через фейковую таблицу) и для sync.js
// (реэкспорт наружу под тот же тест).
export async function runOutbox(table, handler, { deadLetter = true } = {}) {
  const ops = await table.orderBy('seq').toArray()
  for (const op of ops) {
    if (deadLetter && op._dead) continue // отравленная — пропускаем, очередь не блокируем
    try {
      await handler(op)
    } catch (err) {
      const attempts = (op.attempts ?? 0) + 1
      const lastError = String(err?.message ?? err)
      if (deadLetter) {
        const dead = attempts >= MAX_ATTEMPTS
        await table.update(op.seq, { attempts, lastError, ...(dead ? { _dead: 1 } : {}) })
        if (dead) continue // в dead-letter — не вешаем очередь, идём дальше
        throw err // прекращаем проход, попробуем позже
      }
      // без dead-letter (реакции): после MAX просто выбрасываем, иначе копим attempts
      if (attempts >= MAX_ATTEMPTS) { await table.delete(op.seq); continue }
      await table.update(op.seq, { attempts, lastError })
      // не блокируем остальную очередь — пробуем следующие
    }
  }
}

// Отправляем пользовательские упражнения (ex_outbox) в Supabase. Идёт ПЕРЕД
// push() тренировок: запись может ссылаться на свежесозданное упражнение (FK),
// поэтому упражнение должно появиться на сервере первым. Upsert по id
// идемпотентен — повторная отправка после обрыва безопасна.
export async function pushExercises(d = db) {
  await runOutbox(d.ex_outbox, async (op) => {
    const ex = await d.exercises.get(op.exerciseId)
    if (!ex) {
      await d.ex_outbox.delete(op.seq)
      return
    }
    const { error } = await withTimeout(
      supabase.from('exercises').upsert(
        {
          id: ex.id,
          name: ex.name,
          muscle_group: ex.muscle_group ?? null,
          submuscle: ex.submuscle ?? null,
          secondary: ex.secondary ?? [],
          is_custom: true,
          is_bench_lift: Boolean(ex.is_bench_lift),
          metric: ex.metric ?? 'weight',
        },
        { onConflict: 'id' }
      )
    )
    if (error) throw error
    await d.exercises.update(ex.id, { _dirty: 0 })
    await d.ex_outbox.delete(op.seq)
  })
}

// Отправляем шаблоны (tpl_outbox) в Supabase. Идёт ПОСЛЕ pushExercises и ДО
// push() тренировок: template_exercises.exercise_id ссылается на exercises (FK),
// поэтому упражнение должно появиться на сервере раньше шаблона. Upsert по
// клиентскому id идемпотентен — повтор после обрыва безопасен.
export async function pushTemplates(d = db) {
  await runOutbox(d.tpl_outbox, async (op) => {
    if (op.type === 'upsert') {
      const doc = await d.templates.get(op.templateId)
      if (!doc || doc._deleted) {
        await d.tpl_outbox.delete(op.seq)
        return
      }
      // Передаём упорядоченный массив объектов {id, sets, reps, weight}.
      // Серверный upsert_template принимает и легаси-форму (массив строк-uuid),
      // поэтому совместим при поэтапной раскатке (сервер обновляется раньше).
      const exerciseIds = [...(doc.exercises ?? [])]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((e) => ({
          id: e.exercise_id,
          sets: e.sets ?? null,
          reps: e.reps ?? null,
          weight: e.weight ?? null,
        }))
      const { error } = await withTimeout(
        supabase.rpc('upsert_template', {
          p_template_id: doc.id,
          p_user_id: doc.user_id,
          p_name: doc.name,
          p_exercise_ids: exerciseIds,
          p_is_public: !!doc.is_public,
        })
      )
      if (error) throw error
      await d.templates.update(doc.id, { _dirty: 0 })
      await d.tpl_outbox.delete(op.seq)
    } else if (op.type === 'delete') {
      const { error } = await withTimeout(
        supabase.from('workout_templates').delete().eq('id', op.templateId)
      )
      if (error) throw error
      await d.templates.delete(op.templateId)
      await d.tpl_outbox.delete(op.seq)
    }
  })
}

// Отправляем очередь по порядку. На первой же ошибке прекращаем — сохранится
// порядок и не словим частичную отправку при недоступной сети.
export async function push(d = db) {
  // id'шники только что отправленных (upsert) тренировок — отдаём наверх, чтобы
  // последующий pull в этом же цикле не «удалил» их, если read-replica сервера
  // ещё не показывает свежую запись в SELECT (push идёт ДО pull).
  const justPushed = new Set()
  await runOutbox(d.outbox, async (op) => {
    if (op.type === 'upsert') {
      const doc = await d.workouts.get(op.workoutId)
      if (!doc || doc._deleted) {
        await d.outbox.delete(op.seq)
        return
      }
      const payload = doc.entries.map((e) => ({
        exercise_id: e.exercise_id,
        sets: e.sets.map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) })),
      }))
      const { error } = await withTimeout(
        supabase.rpc('upsert_workout', {
          p_workout_id: doc.id,
          p_user_id: doc.user_id,
          p_performed_at: doc.performed_at,
          p_entries: payload,
        })
      )
      if (error) throw error
      // Снимаем _dirty и базис merge-часов: запись уехала, серверный updated_at
      // (истинное время правки) подтянет следующий pull в этом же цикле как
      // чистую (take-server). Базис заново захватит первая локальная правка.
      await d.workouts.update(doc.id, { _dirty: 0, _base_updated_at: null })
      await d.outbox.delete(op.seq)
      justPushed.add(doc.id)
    } else if (op.type === 'delete') {
      const { error } = await withTimeout(
        supabase.from('workouts').delete().eq('id', op.workoutId)
      )
      if (error) throw error
      await d.workouts.delete(op.workoutId)
      await d.outbox.delete(op.seq)
    }
  })
  return justPushed
}

// ----------------------------- реакции -------------------------------------
// Отправляем очередь реакций (reaction_outbox) в Supabase. Реакции всегда СВОИ
// (RLS: user_id = app_uid()), поэтому user_id берём из userId синка. Идёт ПОСЛЕ
// push() тренировок: реакция ссылается на workout (FK) — своя тренировка должна
// уехать раньше (чужие в ленте на сервере уже есть). insert идемпотентен
// (onConflict → ignore), delete по составному ключу. Реакции низкоприоритетны:
// на ошибке НЕ роняем весь синк (вызов обёрнут в try/catch выше), а операцию
// после MAX_ATTEMPTS попыток просто выбрасываем (без dead-letter UI).
export async function pushReactions(userId, d = db) {
  // deadLetter:false — реакции низкоприоритетны: не роняем очередь на ошибке и
  // после MAX_ATTEMPTS просто выбрасываем операцию (без _dead / dead-letter UI).
  await runOutbox(d.reaction_outbox, async (op) => {
    if (op.op === 'add') {
      const { error } = await withTimeout(
        supabase.from('reactions').upsert(
          { user_id: userId, workout_id: op.workoutId, kind: op.kind },
          { onConflict: 'user_id,workout_id,kind', ignoreDuplicates: true }
        )
      )
      if (error) throw error
    } else {
      const { error } = await withTimeout(
        supabase.from('reactions').delete().match({
          user_id: userId, workout_id: op.workoutId, kind: op.kind,
        })
      )
      if (error) throw error
    }
    await d.reaction_outbox.delete(op.seq)
  }, { deadLetter: false })
}

// ------------------------------- цели: push --------------------------------
// Личные цели (ЛК) живут в meta (goal_${userId}) МАССИВОМ. Их надо отдать на
// сервер (таблица goals, составной ключ user_id+exercise_id), чтобы достижение
// увидел Telegram-бот. Пуш — только при _dirty у конкретной цели: upsert_goal
// апсертит/сбрасывает achieved_at при смене веса, delete_my_goal удаляет
// помеченную tombstone (_deleted). Всё обёрнуто в try/catch на стороне вызова:
// если goals-multi.sql ещё не задеплоен (RPC нет) — синк тренировок не падает.
export async function pushGoal(userId, d = db) {
  const goals = await readGoals(userId, d)
  if (!goals.some((g) => g._dirty)) return
  // Рабочая копия ПОЛНОГО массива целей: мутируем по мере успешных операций и
  // персистим СРАЗУ после каждой. Раньше локальное состояние писалось один раз в
  // конце — если 2-я цель кидала, серверная операция по 1-й уже закоммичена, а
  // writeGoals не вызывался → 1-я «залипала» dirty, а tombstone удалённой не
  // снимался. Теперь прерывание в середине оставляет согласованную картину:
  // обработанные цели отражены локально, остаток ждёт следующего pushGoal.
  let next = goals.slice()
  const commit = () => writeGoals(userId, next, d)
  for (const g of goals) {
    // Удаление цели (tombstone): шлём delete_my_goal и выкидываем из массива.
    if (g._deleted && g._dirty) {
      const res = await withTimeout(
        supabase.rpc('delete_my_goal', { p_exercise_id: g.exerciseId })
      )
      if (res.error) throw res.error
      next = next.filter((x) => x.exerciseId !== g.exerciseId)
      await commit()
      continue
    }
    // Поставлена/изменена цель: апсерт по составному ключу.
    if (g._dirty && g.exerciseId && Number(g.targetWeight) > 0) {
      // p_target_weight несёт целевое ведущее значение в единицах метрики
      // (кг / повторы / секунды); p_metric говорит серверу/боту, как трактовать.
      // p_target_reps (PLAN-goal-reps) — необязательные повторы при целевом весе
      // (только у весовой цели); null → требования по повторам нет.
      const reps = Number(g.targetReps)
      const res = await withTimeout(
        supabase.rpc('upsert_goal', {
          p_user_id: userId,
          p_exercise_id: g.exerciseId,
          p_target_weight: Number(g.targetWeight),
          p_metric: normMetric(g.metric),
          p_target_reps: reps > 0 ? Math.round(reps) : null,
        })
      )
      if (res.error) throw res.error
      const row = Array.isArray(res.data) ? res.data[0] : res.data
      next = next.map((x) =>
        x.exerciseId === g.exerciseId
          ? { ...x, _dirty: 0, achievedAt: row?.achieved_at ?? x.achievedAt ?? null }
          : x
      )
      await commit()
      continue
    }
  }
}
