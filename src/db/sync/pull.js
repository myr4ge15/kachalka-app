// ============================================================================
// Синхронизация — стадия PULL. Тянем свежие данные с сервера в Dexie, НЕ затирая
// локальные несинхронизированные изменения (dirty / tombstone). Вынесено из
// sync.js (был 961 строкой — самый крупный и самый рискованный по потере данных
// файл; техдолг «разбить sync.js на pull/push»). Здесь: оркестратор pull() +
// частные подтяжки (справочник/ростер/приватность/тренировки/шаблоны) + pullGoal.
//
// Стадию PUSH см. в ./push.js; наблюдаемое состояние, syncNow и жизненный цикл
// (startSync/Realtime/поллинг) — в ../sync.js. ПОВЕДЕНИЕ НЕ МЕНЯЛОСЬ — это чистый
// перенос кода с правкой относительных путей импорта (модуль стал на уровень
// глубже: '../lib' → '../../lib', './local' → '../local' и т.д.).
// ============================================================================
import { supabase } from '../supabase.js'
import { withTimeout } from '../../lib/withTimeout.js'
import { db, loginDb, nowIso, setMeta, getMeta } from '../local.js'
import { readGoals, writeGoals } from '../notifications.js'
import { normMetric } from '../../lib/metric.js'
import { cmpIsoAsc } from '../../lib/cmp.js'
import { protectedFromPull } from '../../lib/outboxProtect.js'
import { mergeDecision } from '../../lib/mergeClock.js'
import { reconcileStaleWorkouts } from '../../lib/pullReconcile.js'
import { maxUpdatedAt, changedSince, rosterSignature } from '../../lib/pullWatermark.js'
import { pickExerciseShape } from '../../lib/entries.js'

// Инкрементальный pull (BACKLOG-техдолг): вместо полного снапшота всей базы каждые
// 20 c тянем ТОЛЬКО дельту по серверному watermark updated_at. Тренировки —
// `updated_at > wm_workouts` (тяжёлый join лишь по изменённым); справочник/ростер/
// шаблоны — дешёвая проба (max updated_at / сигнатура id) и полный refetch только
// при изменении. Watermark'и/сигнатуры лежат в meta (ключи ниже). Удаления
// тренировок watermark не двигают (строка исчезает) → сверяем отдельно, по
// ПОЛНОМУ дешёвому списку серверных id (select id), как и раньше (см.
// lib/pullReconcile.js, «зазор реконсиляции»).
const WM_WORKOUTS = 'wm_workouts'   // max updated_at принятых тренировок
const WM_EXERCISES = 'wm_exercises' // max updated_at справочника
const SIG_USERS = 'sig_login_users' // сигнатура ростера (id + max updated_at)
const SIG_TEMPLATES = 'sig_templates' // сигнатура окна шаблонов «мои ∪ общие»
// Кандидаты на удаление тренировки, отсутствовавшие на ПРОШЛОЙ сверке id. Удаляем
// только со второго подряд отсутствия — страховка от лага read-replica (см.
// lib/pullReconcile.js reconcileStaleWorkouts).
const PENDING_DELETES = 'pending_workout_deletes'
const SELECT_WORKOUT =
  'id, performed_at, created_at, updated_at, user_id, ' +
  'workout_exercises(id, position, exercise_id, ' +
  'exercise:exercises(id, name, muscle_group, submuscle, secondary, is_bench_lift, metric), ' +
  'sets(id, set_number, weight, reps))'
const SELECT_TEMPLATE =
  'id, name, user_id, is_public, created_at, updated_at, author:users(name), ' +
  'template_exercises(position, exercise_id, target_sets, target_reps, target_weight, ' +
  'exercise:exercises(id, name, muscle_group, submuscle, secondary, is_bench_lift, metric))'

// server row → локальный денормализованный документ
function rowToDoc(w) {
  const entries = [...(w.workout_exercises ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((we) => ({
      exercise_id: we.exercise_id,
      // Единый снимок упражнения (двухуровневая модель мышц: submuscle + secondary).
      // Фолбэк при отсутствии join'а — минимальный {id, name:'—'}.
      exercise: we.exercise
        ? pickExerciseShape(we.exercise)
        : { id: we.exercise_id, name: '—' },
      sets: [...(we.sets ?? [])]
        .sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
        .map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) })),
    }))
  return {
    id: w.id,
    user_id: w.user_id,
    performed_at: w.performed_at,
    // created_at с сервера (для сортировки хаба). Фолбэк на performed_at,
    // если сервер ещё не отдаёт это поле.
    created_at: w.created_at ?? w.performed_at,
    // updated_at — СЕРВЕРНЫЕ merge-часы (PLAN-merge-clock): монотонное время
    // последней правки, назначается сервером в upsert_workout. Сравнивается на
    // pull с локальным базисом (_base_updated_at). Фолбэк на created_at для строк
    // со старого сервера, ещё не отдающего колонку.
    updated_at: w.updated_at ?? w.created_at ?? nowIso(),
    entries,
    _dirty: 0,
    _deleted: 0,
  }
}

// server row → локальный денормализованный документ шаблона
function templateRowToDoc(t) {
  const exercises = [...(t.template_exercises ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((te, i) => ({
      exercise_id: te.exercise_id,
      exercise: te.exercise
        ? pickExerciseShape(te.exercise)
        : { id: te.exercise_id, name: '—' },
      position: i,
      // Целевой план (подходы × повторы × вес). Легаси-строки без целей → null;
      // редактор/применение подставят дефолты.
      sets: te.target_sets ?? null,
      reps: te.target_reps ?? null,
      weight: te.target_weight != null ? Number(te.target_weight) : null,
    }))
  return {
    id: t.id,
    user_id: t.user_id,
    name: t.name,
    // Видимость как 0|1 (см. repo.saveTemplate). author_name — для пометки
    // «от <Имя>» у чужих общих шаблонов (своё имя в UI не показываем).
    is_public: t.is_public ? 1 : 0,
    author_name: t.author?.name ?? null,
    created_at: t.created_at ?? nowIso(),
    updated_at: t.updated_at ?? t.created_at ?? nowIso(),
    exercises,
    _dirty: 0,
    _deleted: 0,
  }
}

// d — ЗАХВАЧЕННЫЙ на входе syncNow инстанс персональной базы (см. syncNow). Все
// записи идут в него, а не в живую модульную привязку `db`: если пользователь
// сменит учётку посреди сетевого await, `db` укажет на чужую базу, а `d` останется
// прежним (и уже закрытым при свопе → запись бросит DatabaseClosedError, прогон
// аборнётся в catch — без кросс-протечки данных A в базу B).
// Оркестратор pull: последовательно гоняет частные подтяжки и собирает их
// предупреждения в один список. Порядок сохранён историческим (FK-зависимостей
// между подтяжками нет). Частичные сбои НЕ роняют синк (тренировки важнее
// справочника) и не маскируются под успех — каждая подтяжка возвращает свои
// warnings наверх, статус покажет «синхронизировано, но справочник/шаблоны не
// обновились». Исключение — pullWorkouts: ошибка ОСНОВНОГО оконного запроса
// тренировок БРОСАЕТ (это сетевой сбой всего прогона, ловится в syncNow).
// Хелперы объявлены ниже (function-declaration'ы хойстятся).
export async function pull(userId, justPushed = new Set(), d = db) {
  // Независимые подтяжки (FK-зависимостей между ними нет — исторически шли цепочкой
  // await лишь по привычке) гоняем ПАРАЛЛЕЛЬНО: wall-clock цикла синка схлопывается
  // с СУММЫ round-trip'ов в МАКСИМУМ одного. Каждую заворачиваем так, чтобы она НЕ
  // реджектила Promise.all — иначе оставшиеся in-flight подтяжки после первого
  // реджекта дали бы unhandled rejection. Разбираем результат сами ниже.
  const wrap = (p) => p.then((w) => ({ ok: true, w })).catch((e) => ({ ok: false, e }))
  const [ex, ros, , wk, tpl] = await Promise.all([
    wrap(pullExercises(d)),
    wrap(pullRoster(d)),
    wrap(pullPrivacyFlag(userId, d)), // best-effort, warnings не копит
    wrap(pullWorkouts(userId, justPushed, d)),
    wrap(pullTemplates(userId, d)),
  ])
  // Тренировки — КРИТИЧНАЯ подтяжка: её сбой = сетевой сбой всего прогона (как и
  // раньше, когда throw из pullWorkouts пробрасывался в syncNow → netError). Бросаем
  // ПОСЛЕ того, как Promise.all дождался остальных, поэтому unhandled rejection нет.
  if (!wk.ok) throw wk.e
  // Остальные подтяжки некритичны: сетевой сбой любой из них теперь деградирует
  // мягко — предупреждение вместо падения всего прогона (тренировки важнее
  // справочника/ростера/шаблонов), синк при этом считается прошедшим. Раньше сбой
  // ЛЮБОЙ из них (шли до pullWorkouts) ронял и синхронизацию тренировок.
  const warnings = [...(wk.w ?? [])]
  for (const r of [ex, ros, tpl]) {
    if (r.ok) warnings.push(...(r.w ?? []))
    else warnings.push(String(r.e?.message ?? r.e))
  }
  return warnings
}

// --------------------------- pull: справочник ------------------------------
async function pullExercises(d = db) {
  const warnings = []
  // справочник упражнений. Инкрементально: сперва дешёвая проба самого свежего
  // updated_at (1 строка). Не вырос с прошлого раза → пропускаем целиком (ни
  // трансфера, ни churn'а Dexie). Удаления справочника не бывает (soft-hide через
  // is_hidden — строка остаётся, триггер двигает updated_at), поэтому max-watermark
  // ПОЛНЫЙ: пропущенного нет. Проба упала (старый сервер без колонки / сеть) →
  // деградируем к прежнему полному refetch, чтобы синк справочника не встал.
  const exProbe = await withTimeout(
    // nullsFirst:false — иначе при descending Postgres ставит NULL первым, и если
    // хоть у одной строки updated_at пуст, проба вернёт null → changedSince(null,…)
    // === false → полный refetch справочника пропускается, новые упражнения не
    // подтянутся. Нужен именно МАКСИМАЛЬНЫЙ непустой updated_at.
    supabase.from('exercises').select('updated_at')
      .order('updated_at', { ascending: false, nullsFirst: false }).limit(1)
  )
  const exServerMax = exProbe.error ? null : (exProbe.data?.[0]?.updated_at ?? null)
  const exChanged = exProbe.error ? true : changedSince(exServerMax, await getMeta(WM_EXERCISES, d))
  if (exChanged) {
    // НЕ затираем локально созданные упражнения, которые ещё не доехали до сервера
    // (_dirty=1) — иначе своё упражнение пропадёт из пикера до завершения синка.
    const ex = await withTimeout(
      supabase.from('exercises').select('id, name, muscle_group, submuscle, secondary, is_bench_lift, is_female_lift, is_custom, is_hidden, metric, updated_at')
    )
    if (ex.error) warnings.push('упражнения: ' + (ex.error.message ?? ex.error))
    else if (ex.data) {
      const serverExIds = new Set(ex.data.map((e) => e.id))
      await d.transaction('rw', d.exercises, d.ex_outbox, async () => {
        const dirty = await d.exercises.filter((e) => e._dirty).toArray()
        const ops = await d.ex_outbox.toArray()
        await d.exercises.clear()
        await d.exercises.bulkPut(ex.data)
        // вернуть несинхронизированные локальные упражнения, если сервер их ещё не знает
        for (const e of dirty) if (!serverExIds.has(e.id)) await d.exercises.put(e)
        // Сервер уже знает ранее «грязное» упражнение → его версия принята выше
        // (clear+bulkPut), а операция в очереди осиротела. Выкидываем её, чтобы не
        // слать лишний upsert на следующем push (симметрично обработке шаблонов).
        for (const e of dirty)
          if (serverExIds.has(e.id))
            for (const o of ops) if (o.exerciseId === e.id) await d.ex_outbox.delete(o.seq)
      })
      // watermark = max по фактически принятым строкам (safe против лага реплики:
      // если проба видела свежее, чем refetch, следующий прогон дотянет).
      await setMeta(WM_EXERCISES, maxUpdatedAt(ex.data) ?? exServerMax, d)
    }
  }
  return warnings
}

// ----------------------------- pull: ростер --------------------------------
async function pullRoster(d = db) {
  const warnings = []
  // пользователи (имена для пикера входа). Тянем из view login_users — только
  // id и name, без pin_hash/pin_salt/role: хэши больше не отдаются клиентам
  // (сверка PIN — в auth-login онлайн или по своему кэшу офлайн, см. lib/auth.js).
  // Инкрементально: дешёвая проба (id, updated_at) → сигнатура. Не изменилась →
  // пропуск. Сигнатура (набор id + max updated_at) ловит и правку (updated_at
  // растёт), и удаление/появление учётки (меняется набор id) — одного max мало.
  const usProbe = await withTimeout(supabase.from('login_users').select('id, updated_at'))
  const usSig = usProbe.error ? null : rosterSignature(usProbe.data ?? [])
  const usChanged = usProbe.error ? true : usSig !== (await getMeta(SIG_USERS, d))
  if (usChanged) {
    const us = await withTimeout(supabase.from('login_users').select('id, name, avatar_url, sort_order, sex'))
    if (us.error) warnings.push('пользователи: ' + (us.error.message ?? us.error))
    else if (us.data) {
      // Ростер — общий для устройства (loginDb), а не персональный: его читает
      // пикер входа до выбора учётки. См. local.js / repo.getUsers.
      await loginDb.transaction('rw', loginDb.users, async () => {
        await loginDb.users.clear()
        await loginDb.users.bulkPut(us.data)
      })
      if (usSig !== null) await setMeta(SIG_USERS, usSig, d)
    }
  }
  return warnings
}

// --------------------------- pull: приватность -----------------------------
// Свой флаг приватности (для UI: у приватного прячем блок лидерборда и место в
// профиле). Колонка is_private клиентам не грантится → берём через RPC
// my_is_private (DEFINER). Не критично для синка — ошибку только проглатываем,
// warnings не копим (флаг косметический).
async function pullPrivacyFlag(userId, d = db) {
  try {
    const pv = await withTimeout(supabase.rpc('my_is_private'))
    if (!pv.error) await setMeta(`priv_${userId}`, Boolean(pv.data), d)
  } catch { /* офлайн/старый сервер — оставляем прежнее значение флага */ }
}

// -------------------------- pull: тренировки -------------------------------
async function pullWorkouts(userId, justPushed = new Set(), d = db) {
  const warnings = []
  // тренировки пользователя — ТОЛЬКО дельта по watermark. Первый прогон (wm пуст)
  // тянет всю историю один раз, дальше — лишь `updated_at > wm` (обычно 0 строк).
  // Порядок по updated_at asc, чтобы watermark двигался монотонно. Лимита нет:
  // ограничивать нельзя (отсечённые старше wm строки иначе не доедут никогда).
  const wmWorkouts = await getMeta(WM_WORKOUTS, d)
  let wkQuery = supabase.from('workouts').select(SELECT_WORKOUT).eq('user_id', userId)
  if (wmWorkouts) wkQuery = wkQuery.gt('updated_at', wmWorkouts)
  wkQuery = wkQuery.order('updated_at', { ascending: true })
  // Оконный запрос дельты (тяжёлый join) и ПОЛНЫЙ набор серверных id (без join'ов —
  // дёшево, лишь UUID'ы для НАДЁЖНОЙ реконсиляции удалений: контент тянем по
  // watermark, но удаления так не увидеть — строка исчезает, updated_at не растёт)
  // независимы → гоняем одним Promise.all (–1 round-trip). Список id заворачиваем в
  // .catch: его сетевой сбой НЕ должен ронять прогон — реконсиляцию удалений в этом
  // цикле просто пропускаем (не удаляем вслепую), поэтому приводим к форме { error }
  // как у PostgREST, а не даём Promise.all зареджектиться.
  const [wk, idsRes] = await Promise.all([
    withTimeout(wkQuery),
    withTimeout(supabase.from('workouts').select('id').eq('user_id', userId))
      .catch((e) => ({ error: e })),
  ])
  if (wk.error) throw wk.error
  const serverRows = wk.data ?? []

  let allServerIds = null
  if (idsRes.error) warnings.push('удаления не сверены: ' + (idsRes.error.message ?? idsRes.error))
  else allServerIds = new Set((idsRes.data ?? []).map((r) => r.id))

  // Кандидаты на удаление с прошлого прогона (отсутствовали на ПРОШЛОЙ сверке id).
  // Читаем ДО транзакции (meta — другая таблица). Сверку удалений в этом прогоне
  // делаем только если полный список id доехал (allServerIds !== null).
  const prevPending = allServerIds ? ((await getMeta(PENDING_DELETES, d)) ?? []) : null
  let reconcile = null

  // Конфликты merge-часов копим и логируем ПОСЛЕ транзакции (db.meta — другая
  // таблица, не в скоупе db.workouts/db.outbox этой транзакции).
  const conflicts = []
  await d.transaction('rw', d.workouts, d.outbox, async () => {
    const locals = await d.workouts.where('user_id').equals(userId).toArray()
    const localById = new Map(locals.map((w) => [w.id, w]))

    for (const row of serverRows) {
      const local = localById.get(row.id)
      const serverDoc = rowToDoc(row)
      if (!local) {
        await d.workouts.put(serverDoc)
        continue
      }
      // Часы-осведомлённое решение (PLAN-merge-clock): сравниваем серверный
      // updated_at с локальным базисом (_base_updated_at).
      const decision = mergeDecision({
        dirty: Boolean(local._dirty),
        deleted: Boolean(local._deleted),
        baseUpdatedAt: local._base_updated_at,
        serverUpdatedAt: serverDoc.updated_at,
      })
      if (decision === 'take-server') {
        await d.workouts.put(serverDoc)
      } else if (decision === 'conflict') {
        // Slice 1: выживает более поздняя по updated_at правка, проигравшую
        // логируем — тихая потеря становится видимой. Сравнение «локальное
        // клиентское время vs серверное» — best-effort (часы устройств могут
        // расходиться), но единственный сигнал времени для ещё не отправленной
        // локальной правки.
        const serverLater = cmpIsoAsc(local.updated_at, serverDoc.updated_at) <= 0
        conflicts.push({
          id: row.id,
          at: nowIso(),
          winner: serverLater ? 'server' : 'local',
          base: local._base_updated_at ?? null,
          server: serverDoc.updated_at ?? null,
          local: local.updated_at ?? null,
        })
        if (serverLater) {
          // Серверная правка позже — принимаем её и снимаем осиротевшую очередь
          // этой тренировки, чтобы наша проигравшая версия не уехала обратно.
          await d.workouts.put(serverDoc)
          const ops = await d.outbox.where('workoutId').equals(row.id).toArray()
          for (const o of ops) if (o.type === 'upsert') await d.outbox.delete(o.seq)
        }
        // serverLater=false → наша правка позже: оставляем локальную (push довезёт).
      }
      // decision === 'keep-local' → запись не трогаем (правка ждёт push'а).
    }
    // Удалённые на сервере (и чистые локально) — убираем локально. Сверка по
    // ПОЛНОМУ набору серверных id (allServerIds), а не по окну контента: так
    // доезжает и удаление записи старше окна. _dirty/_deleted и только что
    // отправленные (лаг read-replica) защищены внутри selectStaleWorkoutIds.
    // allServerIds === null → запрос id упал, реконсиляцию удалений пропускаем.
    // Удаляем ТОЛЬКО id, отсутствовавший на ДВУХ подряд сверках (reconcileStale
    // Workouts): защита чужой чистой записи от лага реплики (см. pullReconcile.js).
    if (allServerIds) {
      reconcile = reconcileStaleWorkouts(locals, allServerIds, justPushed, prevPending)
      for (const id of reconcile.toDelete) await d.workouts.delete(id)
    }
  })

  // Пронести кандидатов на удаление в следующий прогон (только если сверка была).
  if (reconcile) await setMeta(PENDING_DELETES, reconcile.nextCandidates, d)

  // Двигаем watermark тренировок = max updated_at по ФАКТИЧЕСКИ полученным строкам
  // (не по пробе): если реплика отстала и отдала меньше, чем есть на праймари,
  // непришедшие строки останутся > wm и дотянутся следующим прогоном — без потери.
  // Пусто (дельты не было) → watermark не трогаем.
  // NB: fetchedMax считается по ВСЕМ полученным строкам, включая те, что мы решили
  // НЕ принимать (keep-local / конфликт в пользу локальной версии). Это корректно,
  // ПОКА локальную правку довезёт push: тогда серверный updated_at обгонит watermark
  // и строка при следующем pull приедет как take-server. Если же очередь этой правки
  // умрёт в dead-letter — серверную версию watermark уже «перешагнул» (updated_at ≤
  // wm) и инкрементальный .gt её не дотянет; узкий путь рассинхрона, лечится разбором
  // dead-letter (retry/discard в Профиле).
  const fetchedMax = maxUpdatedAt(serverRows)
  if (fetchedMax && changedSince(fetchedMax, wmWorkouts)) {
    await setMeta(WM_WORKOUTS, fetchedMax, d)
  }

  // Журнал конфликтов merge-часов (последние 50) + предупреждение в статус синка.
  if (conflicts.length) {
    try {
      const prev = (await getMeta('merge_conflicts', d)) ?? []
      await setMeta('merge_conflicts', [...prev, ...conflicts].slice(-50), d)
    } catch { /* журнал диагностики не критичен для синка */ }
    warnings.push(`правок перезаписано новее с другого устройства: ${conflicts.length}`)
  }
  return warnings
}

// --------------------------- pull: шаблоны ---------------------------------
async function pullTemplates(userId, d = db) {
  const warnings = []
  // шаблоны: «мои ∪ общие в круге» (их мало). Инкрементально: дешёвая проба
  // (id, updated_at) по окну → сигнатура. Не изменилась → пропуск тяжёлого fetch'а
  // (join с template_exercises). Сигнатура ловит и правку (updated_at растёт), и
  // пропажу чужого общего (автор сделал приватным → id выпал из окна) — одного max
  // мало. Проба упала → деградируем к полному refetch.
  const tplProbe = await withTimeout(
    supabase.from('workout_templates').select('id, updated_at').or(`user_id.eq.${userId},is_public.eq.true`)
  )
  const tplSig = tplProbe.error ? null : rosterSignature(tplProbe.data ?? [])
  const tplChanged = tplProbe.error ? true : tplSig !== (await getMeta(SIG_TEMPLATES, d))
  if (tplChanged) {
    // Не затираем локальные несинхронизированные изменения.
    const tpl = await withTimeout(
      supabase
        .from('workout_templates')
        .select(SELECT_TEMPLATE)
        .or(`user_id.eq.${userId},is_public.eq.true`)
    )
    if (tpl.error) warnings.push('шаблоны: ' + (tpl.error.message ?? tpl.error))
    else if (tpl.data) {
      const tplIds = new Set(tpl.data.map((r) => r.id))
      await d.transaction('rw', d.templates, d.tpl_outbox, async () => {
        // Окно реконсиляции = «мои ∪ общие» (совпадает с выборкой выше). Перебираем
        // ВСЕ локальные шаблоны: чистую запись, входившую в окно, но пропавшую из
        // свежей выборки, удаляем — так уходит чужой общий, который автор сделал
        // приватным. Тумбстоны и _dirty с ЖИВОЙ операцией в очереди защищаем; _dirty
        // без живой операции (очередь умерла в dead-letter/пуста) НЕ защищаем — её
        // флаг иначе не снять, отдаём приоритет серверу и гасим «вечный» кружок.
        const locals = await d.templates.toArray()
        const ops = await d.tpl_outbox.toArray()
        const protectedIds = protectedFromPull(locals, ops)
        const dirtyIds = new Set(locals.filter((t) => t._dirty).map((t) => t.id))
        for (const row of tpl.data) {
          if (protectedIds.has(row.id)) continue
          await d.templates.put(templateRowToDoc(row))
          // Приняли серверную версию ранее «грязной» записи → выкидываем её
          // осиротевшие/мёртвые операции, чтобы очередь не копила мусор.
          if (dirtyIds.has(row.id)) {
            for (const o of ops) if (o.templateId === row.id) await d.tpl_outbox.delete(o.seq)
          }
        }
        for (const t of locals) {
          if (tplIds.has(t.id) || t._dirty || t._deleted) continue
          // входила ли запись в окно выборки (моя или публичная)?
          const inWindow = t.user_id === userId || t.is_public
          if (!inWindow) continue
          await d.templates.delete(t.id)
        }
      })
      if (tplSig !== null) await setMeta(SIG_TEMPLATES, tplSig, d)
    }
  }

  return warnings
}

// ------------------------------- цели: pull --------------------------------
// Подтягиваем серверные цели в локальный массив. Сервер — источник правды, пока
// нет локальных несинхронизированных правок (если есть хоть один _dirty — ждём
// ближайший pushGoal, last-write-wins как у тренировок). Так сюда приезжают цели
// с других устройств, исчезают удалённые там и обновляется achieved_at от бота.
// Имя упражнения — из локального справочника (фолбэк — прежнее имя).
export async function pullGoal(userId, d = db) {
  const local = await readGoals(userId, d)
  if (local.some((g) => g._dirty)) return
  // metric читаем отдельной попыткой: на не-обновлённом сервере колонки ещё нет
  // (тогда select с ней вернёт ошибку → откат на старый набор полей, цели тянутся
  // как весовые). Метрику цели всё равно дублирует metric упражнения в справочнике.
  let res = await withTimeout(
    supabase
      .from('goals')
      .select('exercise_id, target_weight, metric, target_reps, achieved_at')
      .eq('user_id', userId)
  )
  if (res.error) {
    res = await withTimeout(
      supabase
        .from('goals')
        .select('exercise_id, target_weight, achieved_at')
        .eq('user_id', userId)
    )
  }
  if (res.error) return
  const rows = res.data ?? []
  const byEx = new Map(local.map((g) => [g.exerciseId, g]))
  const next = []
  for (const row of rows) {
    const ex = await d.exercises.get(row.exercise_id)
    // target_reps (PLAN-goal-reps) — необязательные повторы при целевом весе у
    // весовой цели; на не-обновлённом сервере поля нет → undefined → null.
    const reps = Number(row.target_reps)
    next.push({
      exerciseId: row.exercise_id,
      exerciseName: ex?.name ?? byEx.get(row.exercise_id)?.exerciseName ?? '—',
      // metric: с сервера, иначе из упражнения (одна метрика на упражнение), иначе 'weight'.
      metric: normMetric(row.metric ?? ex?.metric ?? byEx.get(row.exercise_id)?.metric),
      targetWeight: Number(row.target_weight),
      targetReps: reps > 0 ? Math.round(reps) : null,
      // Достижение МОНОТОННО: раз взятую цель не «разберём» обратно из-за пустого
      // серверного achieved_at. Для не-весовых целей (reps/time) сервер achieved_at
      // НИКОГДА не считает — они достигаются только в приложении (detectGoalReached
      // штампует achievedAt локально). Без сохранения локального значения ближайший
      // pull затирал бы его null → 🎯 и уведомление молча исчезали. Серверное
      // achieved_at (весовые цели, бот) имеет приоритет; иначе держим локальное.
      achievedAt: row.achieved_at ?? byEx.get(row.exercise_id)?.achievedAt ?? null,
      _dirty: 0,
    })
  }
  // Пишем только при реальном изменении состава/значений (чтобы не дёргать
  // useLiveQuery вхолостую). Сравнение нормализованное, по ключу exerciseId.
  const norm = (arr) =>
    JSON.stringify(
      arr
        .filter((g) => !g._deleted)
        .map((g) => [g.exerciseId, Number(g.targetWeight), normMetric(g.metric), Number(g.targetReps) || 0, g.exerciseName ?? '—', g.achievedAt ?? null])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    )
  if (norm(local) !== norm(next)) await writeGoals(userId, next, d)
}
