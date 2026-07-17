// ============================================================================
// Движок синхронизации между локальной базой (Dexie) и Supabase.
//
//   pull  — тянем свежие данные с сервера в Dexie, НЕ затирая локальные
//           несинхронизированные изменения (dirty / tombstone);
//   push  — отправляем очередь `outbox` на сервер через RPC upsert_workout
//           (создание/правка) и delete (удаление). Очередь идёт по порядку;
//           на ошибке останавливаемся и пробуем позже (сеть/сервер недоступны).
//
// Триггеры: вход, событие `online`, возврат вкладки на экран, таймер.
// Конфликты тренировок разрешаются часами (PLAN-merge-clock): сервер ведёт
// монотонный updated_at, на pull он сравнивается с локальным базисом
// (_base_updated_at). Чужая правка позже нашего базиса → конфликт: выживает
// более поздняя версия, проигравшая логируется (видимость вместо тихой потери).
// Шаблоны/упражнения/цели пока по-старому (last-write-wins по _dirty).
// ============================================================================
import { useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase, isConfigured, hasSession } from './supabase.js'
import { withTimeout } from '../lib/withTimeout.js'
import { db, loginDb, nowIso, setMeta, getMeta } from './local.js'
import { pendingCount, deadLetterCount } from './repo.js'
import { fetchFeed } from './feed.js'
import { readGoals, writeGoals } from './notifications.js'
import { normMetric } from '../lib/metric.js'
import { onOnline, onOffline, onResume } from '../lib/appEvents.js'
import { cmpIsoAsc } from '../lib/cmp.js'
import { protectedFromPull } from '../lib/outboxProtect.js'
import { mergeDecision } from '../lib/mergeClock.js'
import { reconcileStaleWorkouts } from '../lib/pullReconcile.js'
import { maxUpdatedAt, changedSince, rosterSignature } from '../lib/pullWatermark.js'
import { pollIntervalFor, isRealtimeAlive, makeDebouncer } from '../lib/realtimeSync.js'
import { backoffDelay, nextFailureCount } from '../lib/backoff.js'
import { pickExerciseShape } from '../lib/entries.js'

// Свернуть всплеск Realtime-событий в один syncNow (несколько правок подряд на
// сервере не должны дёргать pull лавиной). Инкрементальный pull дёшев, поэтому
// небольшого окна хватает, чтобы «друг побил рекорд» ощущалось мгновенным.
const REALTIME_DEBOUNCE_MS = 1200
// После стольких неудачных попыток операция считается «отравленной» и
// откладывается в dead-letter (флаг _dead): она больше не блокирует очередь,
// но остаётся в базе для диагностики. Иначе один битый upsert вешал синк навсегда.
const MAX_ATTEMPTS = 5
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

// ----------------------- наблюдаемое состояние синка -----------------------
// netError — последний ПОЛНЫЙ прогон синка упал по сети/серверу (throw в push/pull,
// напр. таймаут запроса). Отличаем от частичных warning'ов (lastError при обновлённом
// lastSyncAt = синк прошёл): netError=true только когда прогон реально не завершился.
// Нужен шапке, чтобы не рисовать «синхронизировано» поверх молчаливого сбоя (частый
// кейс — авиарежим на десктопе, где navigator.onLine остаётся true). См. lib/syncStatus.js.
let state = { online: navigator.onLine, syncing: false, lastError: null, lastSyncAt: null, netError: false }
const listeners = new Set()
function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
function subscribe(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getSnapshot = () => state

// ------------------------------- pull --------------------------------------

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
async function pull(userId, justPushed = new Set(), d = db) {
  // Частичные сбои pull НЕ роняют весь синк (тренировки важнее справочника), но
  // и не маскируются под успех: копим сообщения и возвращаем их наверх, чтобы
  // статус показал «синхронизировано, но справочник/шаблоны не обновились».
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

  // свой флаг приватности (для UI: у приватного прячем блок лидерборда и место в
  // профиле). Колонка is_private клиентам не грантится → берём через RPC
  // my_is_private (DEFINER). Не критично для синка — ошибку только проглатываем.
  try {
    const pv = await withTimeout(supabase.rpc('my_is_private'))
    if (!pv.error) await setMeta(`priv_${userId}`, Boolean(pv.data), d)
  } catch { /* офлайн/старый сервер — оставляем прежнее значение флага */ }

  // тренировки пользователя — ТОЛЬКО дельта по watermark. Первый прогон (wm пуст)
  // тянет всю историю один раз, дальше — лишь `updated_at > wm` (обычно 0 строк).
  // Порядок по updated_at asc, чтобы watermark двигался монотонно. Лимита нет:
  // ограничивать нельзя (отсечённые старше wm строки иначе не доедут никогда).
  const wmWorkouts = await getMeta(WM_WORKOUTS, d)
  let wkQuery = supabase.from('workouts').select(SELECT_WORKOUT).eq('user_id', userId)
  if (wmWorkouts) wkQuery = wkQuery.gt('updated_at', wmWorkouts)
  wkQuery = wkQuery.order('updated_at', { ascending: true })
  const wk = await withTimeout(wkQuery)
  if (wk.error) throw wk.error
  const serverRows = wk.data ?? []

  // ПОЛНЫЙ набор серверных id тренировок пользователя (без join'ов — дёшево, лишь
  // UUID'ы) для НАДЁЖНОЙ реконсиляции удалений. Контент тянем инкрементально (по
  // watermark), но удаления так не увидеть (строка исчезает, updated_at не растёт)
  // → сверяем с полным списком id. Если этот запрос упал — реконсиляцию удалений
  // в этом прогоне ПРОПУСКАЕМ (не удаляем ничего вслепую), контент/конфликты
  // обрабатываем как обычно.
  const idsRes = await withTimeout(
    supabase.from('workouts').select('id').eq('user_id', userId)
  )
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

// ------------------------------- push --------------------------------------

// Единый прогон очереди outbox с общей политикой повторов/dead-letter (раньше
// этот блок был скопирован в 4 push-циклах, РЕВЬЮ-КОДА-2026-07-13). Идём по seq;
// `handler(op)` делает работу и САМ удаляет операцию на успехе (успех = не бросил).
//   - table — Dexie-таблица очереди (ex_outbox/tpl_outbox/outbox/reaction_outbox);
//   - deadLetter=true (тренировки/упражнения/шаблоны): _dead-операции пропускаем;
//     на ошибке растим attempts, после MAX помечаем `_dead` и идём дальше (не
//     вешаем очередь), иначе БРОСАЕМ — прекращаем проход, сохраняя порядок;
//   - deadLetter=false (реакции, низкий приоритет): без _dead-флага и без throw —
//     после MAX попыток операцию просто выбрасываем, очередь не блокируем.
// Экспортируется для unit-теста (runOutbox.test через фейковую таблицу).
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
async function pushExercises(d = db) {
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
async function pushTemplates(d = db) {
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
async function push(d = db) {
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
async function pushReactions(userId, d = db) {
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

// ------------------------------- цели --------------------------------------
// Личные цели (ЛК) живут в meta (goal_${userId}) МАССИВОМ. Их надо отдать на
// сервер (таблица goals, составной ключ user_id+exercise_id), чтобы достижение
// увидел Telegram-бот. Пуш — только при _dirty у конкретной цели: upsert_goal
// апсертит/сбрасывает achieved_at при смене веса, delete_my_goal удаляет
// помеченную tombstone (_deleted). Всё обёрнуто в try/catch на стороне вызова:
// если goals-multi.sql ещё не задеплоен (RPC нет) — синк тренировок не падает.

async function pushGoal(userId, d = db) {
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

// Подтягиваем серверные цели в локальный массив. Сервер — источник правды, пока
// нет локальных несинхронизированных правок (если есть хоть один _dirty — ждём
// ближайший pushGoal, last-write-wins как у тренировок). Так сюда приезжают цели
// с других устройств, исчезают удалённые там и обновляется achieved_at от бота.
// Имя упражнения — из локального справочника (фолбэк — прежнее имя).
async function pullGoal(userId, d = db) {
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

// --------------------------- оркестрация -----------------------------------
let running = false

// Полный цикл: сначала отдаём локальные изменения, затем забираем серверные.
// Возвращает: true — прогон прошёл (для сброса backoff поллинга), false — сбой
// (для роста интервала), undefined — прогон пропущен (офлайн/нет сессии/уже идёт).
export async function syncNow(userId) {
  if (!isConfigured || !navigator.onLine || running || !userId) return
  // Персональная база ещё не открыта (или уже закрыта после выхода) — синкать
  // некуда. Страховка от запоздалого таймера/события после logout.
  if (!db) return
  // ЗАХВАТ инстанса персональной базы на входе. Модульная привязка `db` — живая:
  // если пользователь сменит учётку посреди сетевого await (push/pull делают
  // supabase.rpc между записями), `db` укажет на базу другой учётки, и записи A
  // ушли бы в базу B — та самая кросс-протечка, ради устранения которой сделана
  // физическая изоляция (v3.0.0). Пробрасываем `d` во все стадии: при свопе `d`
  // (старый инстанс) уже закрыт → запись бросит DatabaseClosedError, прогон
  // аборнётся в catch, чужая база не тронута.
  const d = db
  // Не синкаем, пока не поднята настоящая сессия: pull/push защищённых таблиц
  // ролью `anon` ловят «permission denied» (баг ленты при первом входе). Как
  // только сессия появится, прогон вызовет ре-триггер по onAuthStateChange.
  if (!(await hasSession())) return
  running = true
  setState({ syncing: true })
  try {
    await pushExercises(d) // упражнения раньше всего (FK на exercise_id)
    await pushTemplates(d) // шаблоны после упражнений (FK), до/после тренировок неважно
    const justPushed = await push(d)
    // Реакции (виш BACKLOG) — необязательная соц-часть: ошибка/отсутствие таблицы
    // не должна ронять синк тренировок, поэтому отдельный try/catch.
    try { await pushReactions(userId, d) } catch { /* реакции не критичны для синка */ }
    // Цель (ЛК 2b) — необязательная часть: ошибка/отсутствие RPC не должны
    // ронять синхронизацию тренировок, поэтому отдельный try/catch. Ошибку пуша
    // больше не глотаем молча — показываем как lastError (раньше из-за тихого
    // catch было не видно, почему цель не доезжает до сервера).
    let goalWarn = null
    try { await pushGoal(userId, d) } catch (e) { goalWarn = 'цель не отправлена: ' + String(e?.message ?? e) }
    const warnings = await pull(userId, justPushed, d)
    // pullGoal может пометить локальную цель на отправку (бэкофилл старой цели
    // без _dirty) — сразу доливаем её вторым pushGoal в этом же цикле.
    try {
      await pullGoal(userId, d)
      await pushGoal(userId, d)
    } catch (e) { if (!goalWarn) goalWarn = 'цель не отправлена: ' + String(e?.message ?? e) }
    // Обновляем кэш общей ленты в фоне: его читают и «Лента», и бейджи-
    // уведомления о рекордах («друг побил твой рекорд» — из ленты). Ошибка ленты
    // не должна валить синк своих тренировок, поэтому отдельный try/catch.
    try { await fetchFeed(userId, d) } catch { /* лента не критична для синка */ }
    const at = nowIso()
    await setMeta('lastSyncAt', at, d)
    // Частичные сбои pull (справочник/пользователи/шаблоны не обновились) и сбой
    // пуша цели показываем как lastError, но синк считается прошедшим — lastSyncAt обновлён.
    const allWarn = [...(warnings ?? []), ...(goalWarn ? [goalWarn] : [])]
    // Прогон дошёл до конца (частичные warning'и — не сбой) → netError сброшен.
    setState({ lastError: allWarn.length ? allWarn.join('; ') : null, lastSyncAt: at, netError: false })
    // Прогон дошёл до конца (частичные warning'и — не сбой, lastSyncAt обновлён):
    // возвращаем true, чтобы backoff поллинга сбросился в базовый интервал.
    return true
  } catch (err) {
    // Прогон упал целиком (push/pull бросили) → netError=true: шапка покажет
    // предупреждение вместо ложной галочки «синхронизировано».
    setState({ lastError: String(err?.message ?? err), netError: true })
    // Сбой прогона → false: поллинг растянет интервал (см. lib/backoff.js).
    return false
  } finally {
    running = false
    setState({ syncing: false, online: navigator.onLine })
  }
}

// Запускаем фоновую синхронизацию для пользователя. Возвращает функцию остановки.
export function startSync(getUserId) {
  // Подписки через общий хаб событий (см. lib/appEvents.js): DOM-слушатели там
  // регистрируются один раз на всё приложение.
  // Адаптивный поллинг + экспоненциальный backoff при сбоях (lib/backoff.js).
  // Базовый интервал задаёт Realtime-статус (частый опрос, пока канал не
  // подтверждён; страховочный редкий — при живом канале, он сам толкает изменения),
  // а подряд идущие ошибки синка растягивают его до потолка; первый успех сбрасывает
  // к базовому. Поэтому таймер — самоперепланируемый setTimeout, а не фиксированный
  // setInterval: интервал следующего прогона зависит и от статуса, и от числа сбоев.
  let timer = null
  let baseMs = pollIntervalFor(false)
  let failures = 0
  const scheduleNext = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(tick, backoffDelay(baseMs, failures))
  }
  async function tick() {
    const ok = await syncNow(getUserId())
    failures = nextFailureCount(failures, ok)
    scheduleNext()
  }
  // Сбросить backoff и опросить немедленно — на сильных сигналах «связь вернулась»
  // (снова онлайн / приложение из фона), чтобы не досиживать длинный отступ.
  const retryNow = () => {
    failures = 0
    scheduleNext()
    syncNow(getUserId())
  }

  const offOnline = onOnline(() => {
    setState({ online: true })
    retryNow()
  })
  const offOffline = onOffline(() => setState({ online: false }))
  const offResume = onResume(retryNow)

  scheduleNext()

  // Realtime-триггер (виш BACKLOG): postgres_changes по workouts/goals даёт
  // мгновенное «друг побил рекорд» вместо потолка латентности в POLL_FAST_MS.
  // Событие несёт лишь сигнал «что-то изменилось» → дебаунсим и запускаем обычный
  // syncNow (инкрементальный pull дешёвый). Офлайн-модель не трогаем: канал —
  // ДОПОЛНЕНИЕ к поллингу и очередям, а не замена. RLS фильтрует события до
  // видимых зрителю строк, поэтому каналу нужна поднятая сессия (см. lifecycle ниже).
  const debounced = makeDebouncer(() => syncNow(getUserId()), REALTIME_DEBOUNCE_MS)
  let channel = null
  const applyRealtimeStatus = (status) => {
    const ms = pollIntervalFor(isRealtimeAlive(status))
    if (ms !== baseMs) { baseMs = ms; scheduleNext() }
  }
  const openChannel = () => {
    if (channel) return // канал уже поднят — supabase-js сам обновляет его токен на refresh
    channel = supabase
      .channel('live-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workouts' }, () => debounced.trigger())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'goals' }, () => debounced.trigger())
      .subscribe((status) => applyRealtimeStatus(status))
  }
  const closeChannel = () => {
    if (channel) { supabase.removeChannel(channel); channel = null }
    applyRealtimeStatus('CLOSED') // вернуть таймер к частому опросу-страховке
  }

  // Сессия поднялась (восстановление из хранилища после рестарта ИЛИ молчаливый
  // онлайн-логин по офлайн-кэшу, см. LoginScreen) → сразу синкаем. Без этого
  // первый прогон мог отвалиться по hasSession()=false, а следующего ждать до
  // интервала поллинга; теперь pull/feed/лидерборд подтянутся, как только появится
  // JWT. Тогда же (появился JWT) поднимаем Realtime-канал — без сессии RLS его
  // отвергнет; supabase-js сам обновляет токен канала на TOKEN_REFRESHED, поэтому
  // канал поднимаем ОДИН раз (openChannel идемпотентен), а на SIGNED_OUT — рвём.
  const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
      syncNow(getUserId())
      if (session) openChannel()
    } else if (event === 'SIGNED_OUT') {
      closeChannel()
    }
  })

  syncNow(getUserId()) // первый прогон сразу

  return () => {
    offOnline()
    offOffline()
    offResume()
    if (timer) clearTimeout(timer)
    debounced.cancel()
    if (channel) { supabase.removeChannel(channel); channel = null }
    authSub?.subscription?.unsubscribe?.()
  }
}

// ------------------------------- хук ---------------------------------------
// Статус для UI: онлайн/офлайн, идёт ли синк, сколько изменений в очереди.
export function useSyncStatus() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const pending = useLiveQuery(() => pendingCount(), [], 0)
  // Застрявшие (dead-letter) операции: в pending не входят, но карточки их
  // тренировок висят с _dirty — бейдж должен это отражать (см. lib/syncStatus.js).
  const dead = useLiveQuery(() => deadLetterCount(), [], 0)
  return { ...s, pending: pending ?? 0, dead: dead ?? 0 }
}
