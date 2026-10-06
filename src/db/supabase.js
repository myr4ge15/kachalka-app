import { createClient } from '@supabase/supabase-js'
import { withTimeout } from '../lib/withTimeout.js'

// Проверка личности — один крошечный RPC перед каждым прогоном синка; ждать его
// дольше не стоит: не ответил → «неизвестно», прогон идет с предохранителем.
const IDENTITY_TIMEOUT_MS = 10000

const url = import.meta.env.VITE_SUPABASE_URL
// Publishable key (sb_publishable_...): публичный клиентский ключ, безопасен в коде.
const key = import.meta.env.VITE_SUPABASE_KEY

// В тестах (Vitest, MODE=test) молчим (v6.16.0): там .env намеренно нет (CI), клиент не
// нужен, а строка в каждом прогоне только шумит.
if ((!url || !key) && import.meta.env.MODE !== 'test') {
  // Явная ошибка лучше тихих 401-х при отсутствии .env
  console.error(
    'Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_KEY. ' +
    'Скопируй .env.example в .env и подставь значения из Supabase.'
  )
}

// Сессию дает Supabase Auth (логин-мост, см. src/lib/auth.js): храним и
// автоматически обновляем токен. persistSession кладет сессию в localStorage —
// вход переживает перезапуск приложения (окно ~7 дней задается в Auth→Sessions).
// detectSessionInUrl выключаем: это PWA, не OAuth-редирект.
//
// Плейсхолдеры при отсутствии .env: createClient требует СИНТАКСИЧЕСКИ валидный
// URL и бросает на пустой строке ('supabaseUrl is required'). Раньше этот бросок
// на импорте модуля гасил рендер ДО экрана «Нужна настройка» (белый экран при
// забытом .env — гард isConfigured в App.jsx не успевал сработать) и ронял
// юнит-тесты в CI (там env не задан). При isConfigured=false приложение
// показывает экран настройки и сетевых вызовов не делает — этот клиент не трогается.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }
)
export const isConfigured = Boolean(url && key)

// true, если у клиента УЖЕ поднята настоящая Auth-сессия. Нужно, чтобы не
// дергать защищенные RLS-таблицы (`workouts` и пр.) ролью `anon` в момент, когда
// React-профиль уже восстановлен из localStorage (синхронно), а сессия Supabase
// Auth еще поднимается из своего хранилища асинхронно — иначе первый запрос
// уходит без JWT и RLS отвечает «permission denied for table workouts» (баг при
// первом входе/перезапуске). `getSession()` дожидается окончания инициализации
// GoTrue, поэтому здесь же снимается и гонка восстановления сессии после рестарта.
//
// userId (необязательно) — для КОГО собираемся синкать. Сессия другой учетки
// (осталась на общем устройстве, пока фоновый перевыпуск после офлайн-анлока не
// прошел) приравнивается к отсутствию: под чужим JWT pull отдает пустоту, а push
// личного meta берет владельца из app_uid() — данные B уехали бы в user_meta A.
export async function hasSession(userId = null) {
  if (!isConfigured) return false
  try {
    const { data } = await supabase.auth.getSession()
    const session = data?.session
    if (!session) return false
    return !userId || isSessionOf(session, userId)
  } catch {
    return false
  }
}

// app_user_id из claim'а app_metadata (его кладет auth-login). Нет claim'а —
// сверять не с чем: не блокируем (старые сессии/иной мост), решает серверный RLS.
export function sessionAppUserId(session) {
  return session?.user?.app_metadata?.app_user_id ?? null
}
export function isSessionOf(session, userId) {
  const owner = sessionAppUserId(session)
  return owner == null || String(owner) === String(userId)
}

// Кем сервер считает эту сессию ПРЯМО СЕЙЧАС: rpc('app_uid') — та же функция, на
// которой стоит весь RLS. Claim в JWT (isSessionOf) отвечает лишь «для кого токен
// выпущен»; после сброса PIN админом (session_epoch вырос) токен еще живет до часа,
// но app_uid() уже NULL — и RLS отдает ПУСТЫЕ выборки без ошибки. Клиент принимал
// пустоту за «все удалено» и стирал локальную историю (РЕВЬЮ-КОДА-2026-10-02, п. 1).
// Возвращает:
//   { known: true,  id }   — сервер ответил (id === null → сессия отозвана);
//   { known: false, id: null } — спросить не удалось (сеть, старый сервер без
//     доступа к функции): вызывающий решает сам, блокировать нельзя.
export async function serverIdentity() {
  if (!isConfigured) return { known: false, id: null }
  try {
    const res = await withTimeout(supabase.rpc('app_uid'), IDENTITY_TIMEOUT_MS)
    if (!res || res.error) return { known: false, id: null }
    return { known: true, id: res.data == null ? null : String(res.data) }
  } catch {
    return { known: false, id: null }
  }
}

// «Прогрев» базы: дешевый запрос при старте приложения, чтобы разбудить
// бесплатный проект Supabase из паузы заранее — до того как пользователь
// нажмет «Сохранить». Ошибки молча глотаем: это не критичный путь.
// Бьем по rpc('app_uid'): до входа он вернет null (или отказ в правах — тоже
// годится, запрос все равно дошел до базы). login_users с 6.12.0 закрыт от
// анонимов (login-users-close.sql), а прогрев не должен зависеть от прав.
export function warmup() {
  if (!isConfigured) return
  Promise.resolve()
    .then(() => supabase.rpc('app_uid'))
    .then(() => {}, () => {})
}
