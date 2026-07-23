// ============================================================================
// Движок синхронизации между локальной базой (Dexie) и Supabase — оркестрация.
//
//   pull  — тянем свежие данные с сервера в Dexie, НЕ затирая локальные
//           несинхронизированные изменения (dirty / tombstone) — см. ./sync/pull.js;
//   push  — отправляем очереди outbox на сервер (RPC/таблицы) — см. ./sync/push.js.
//
// Этот файл держит НАБЛЮДАЕМОЕ состояние синка (для UI), полный цикл syncNow
// (порядок стадий из-за FK), жизненный цикл startSync (триггеры/поллинг/Realtime)
// и хук useSyncStatus. Сами стадии pull/push вынесены в ./sync/ (техдолг «разбить
// sync.js»: был 961 строкой — самый крупный и рискованный по потере данных файл).
//
// Триггеры: вход, событие `online`, возврат вкладки на экран, таймер, Realtime.
// Конфликты тренировок разрешаются часами (PLAN-merge-clock): сервер ведёт
// монотонный updated_at, на pull он сравнивается с локальным базисом
// (_base_updated_at). Чужая правка позже нашего базиса → конфликт: выживает
// более поздняя версия, проигравшая логируется (видимость вместо тихой потери).
// Шаблоны/упражнения/цели пока по-старому (last-write-wins по _dirty).
// ============================================================================
import { useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase, isConfigured, hasSession } from './supabase.js'
import { db, nowIso, setMeta } from './local.js'
import { pendingCount, deadLetterCount } from './repo.js'
import { fetchFeed } from './feed.js'
import { onOnline, onOffline, onResume } from '../lib/appEvents.js'
import { pollIntervalFor, isRealtimeAlive, makeDebouncer } from '../lib/realtimeSync.js'
import { backoffDelay, nextFailureCount } from '../lib/backoff.js'
import { pull, pullGoal } from './sync/pull.js'
import { push, pushExercises, pushTemplates, pushReactions, pushGoal } from './sync/push.js'

// runOutbox живёт в стадии push, но исторически экспортировался из sync.js (его
// дёргает sync.test через фейковую таблицу) — сохраняем публичную точку.
export { runOutbox } from './sync/push.js'

// Свернуть всплеск Realtime-событий в один syncNow (несколько правок подряд на
// сервере не должны дёргать pull лавиной). Инкрементальный pull дёшев, поэтому
// небольшого окна хватает, чтобы «друг побил рекорд» ощущалось мгновенным.
const REALTIME_DEBOUNCE_MS = 1200

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
