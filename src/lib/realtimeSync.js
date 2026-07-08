// Чистые хелперы Realtime-триггера синка (без Supabase/сети/Dexie). Задача:
// заменить «потолок латентности» поллинга раз в 20 c мгновенным толчком по
// событию из Supabase Realtime (postgres_changes на workouts/goals), оставив
// поллинг как страховку. Логика вынесена сюда, чтобы покрыть тестами (по образцу
// pullWatermark.js / mergeClock.js). Потребитель — src/db/sync.js (startSync).

// Интервалы поллинга. Пока Realtime НЕ подтверждён (нет живого канала) — частый
// опрос, как раньше. Как только канал SUBSCRIBED — он сам толкает свежие
// изменения, поэтому поллинг растягиваем до редкой страховки (батарея мобильного
// PWA не греется фоновым O(вся база) каждые 20 c). Обрыв канала → снова частый.
export const POLL_FAST_MS = 20000 // нет живого Realtime — частый опрос (прежнее поведение)
export const POLL_SLOW_MS = 60000 // Realtime подтверждён — редкий опрос-страховка

// Интервал поллинга в зависимости от того, жив ли Realtime-канал.
export function pollIntervalFor(realtimeAlive) {
  return realtimeAlive ? POLL_SLOW_MS : POLL_FAST_MS
}

// Считаем канал «живым» ТОЛЬКО на подтверждённой подписке. Прочие статусы
// supabase-js (CHANNEL_ERROR / TIMED_OUT / CLOSED / undefined при подключении)
// → страховочный частый опрос, чтобы не «застыть» на редком поллинге при
// молча оборвавшемся Realtime.
export function isRealtimeAlive(status) {
  return status === 'SUBSCRIBED'
}

// Свернуть всплеск событий (insert одной тренировки на сервере может сопровождать
// пачку близких изменений) в один отложенный вызов fn — trailing debounce.
// Таймеры инъектируются (setTimeout/clearTimeout по умолчанию) ради тестов.
// Возвращает { trigger, cancel }: trigger откладывает вызов на delay, повторный
// trigger в окне сбрасывает таймер; cancel снимает отложенный вызов (для cleanup).
export function makeDebouncer(fn, delay, setTimer = setTimeout, clearTimer = clearTimeout) {
  let t = null
  return {
    trigger() {
      if (t !== null) clearTimer(t)
      t = setTimer(() => { t = null; fn() }, delay)
    },
    cancel() {
      if (t !== null) { clearTimer(t); t = null }
    },
  }
}
