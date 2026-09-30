import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
// Publishable key (sb_publishable_...): публичный клиентский ключ, безопасен в коде.
const key = import.meta.env.VITE_SUPABASE_KEY

if (!url || !key) {
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

// «Прогрев» базы: дешевый запрос при старте приложения, чтобы разбудить
// бесплатный проект Supabase из паузы заранее — до того как пользователь
// нажмет «Сохранить». Ошибки молча глотаем: это не критичный путь.
// Бьем по login_users (доступен анониму и после ужесточения RLS) — иначе
// прогрев по exercises после ужесточения словил бы 401.
export function warmup() {
  if (!isConfigured) return
  supabase
    .from('login_users')
    .select('id', { head: true, count: 'exact' })
    .then(() => {}, () => {})
}
