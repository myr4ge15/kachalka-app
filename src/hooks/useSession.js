import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../db/supabase.js'
import { logout as authLogout, getCachedProfile } from '../lib/auth.js'
import { releasePushOnLogout, reconcilePushOwner } from '../db/push.js'
import { getCachedUser } from '../db/repo.js'
import { openUserDb, closeUserDb } from '../db/local.js'
import { readStoredUserId, hydrateProfile } from '../lib/sessionProfile.js'
import { markAppReady } from '../lib/splash.js'
import { storageGet, storageSet, storageRemove } from '../lib/safeStorage.js'

// Сессия приложения (вынесено из App.jsx в v6.14.1, код — дословно): кто вошел,
// восстановление после перезапуска, реакция на SIGNED_IN/SIGNED_OUT Supabase Auth,
// вход/выход/переименование. Порядок «открыть персональную базу ДО setUser» и
// «setUser(null) ДО closeUserDb» — инвариант (экраны и синк читают `db`).
// onLoggedIn() — после входа с экрана входа/приглашения (App переключает на Главную).
// Возвращает { user, handleLogin, handleRenamed, handleLogout }.

// В localStorage держим ТОЛЬКО id вошедшего (не имя/роль): на общих телефонах
// профиль лежал открыто и читался через devtools. Имя/роль восстанавливаем из
// loginDb (ростер + офлайн-кэш PIN, см. handleLogin/restore). id переживает
// перезапуск, как и сессия Supabase Auth (persistSession); PIN спрашивается
// заново лишь когда refresh-токен умрет (~7 дней) или после logout.
export const SESSION_KEY = 'gym_app_user'

export function useSession(onLoggedIn) {
  const [user, setUser] = useState(null)

  // Восстановление профиля после перезапуска. В localStorage лежит только id;
  // имя берем из ростера (loginDb.users, свежий после pull), роль — из офлайн-
  // кэша PIN (в ростер роль не отдается). Работает офлайн (оба источника
  // локальные). Персональную базу открываем ДО setUser, иначе экраны/синк
  // прочитают еще закрытый `db`. Старый «толстый» блок {id,name,role} читаем по
  // id и тут же перезаписываем тонким — стираем утекшие имя/роль.
  // Готовность для сплэша (markAppReady) — по итогу восстановления: без этого
  // сплэш снимался по таймеру и мельком показывал экран входа, пока база открывалась.
  useEffect(() => {
    const id = readStoredUserId(storageGet('localStorage', SESSION_KEY))
    if (!id) { markAppReady(); return }
    ;(async () => {
      const [roster, cache] = await Promise.all([getCachedUser(id), getCachedProfile(id)])
      await openUserDb(id)
      storageSet('localStorage', SESSION_KEY, JSON.stringify({ id }))
      setUser(hydrateProfile(id, roster, cache))
    })()
      // Не глушим молча: человек окажется на экране входа, и без следа в консоли
      // такие случаи (напр. не открылась персональная база) не разобрать.
      .catch((err) => console.error('Не удалось восстановить сессию:', err))
      .finally(markAppReady)
  }, [])

  // Если сессия Supabase завершилась (refresh-токен истек через ~7 дней или
  // logout) — возвращаем на экран входа. Офлайн событие не приходит, поэтому
  // UI остается доступным до появления сети (тогда либо тихий перевыпуск, либо
  // SIGNED_OUT → PIN заново).
  // Подписка на пуши — за той учеткой, что вошла (общий телефон): сверка при
  // входе и, раз уж серверной части нужна своя сессия, еще раз, когда она поднялась.
  const userIdRef = useRef(null)
  useEffect(() => {
    userIdRef.current = user?.id ?? null
    if (user?.id) reconcilePushOwner(user.id)
  }, [user?.id])
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' && userIdRef.current) reconcilePushOwner(userIdRef.current)
      if (event === 'SIGNED_OUT') {
        storageRemove('localStorage', SESSION_KEY)
        setUser(null)
        closeUserDb()
      }
    })
    return () => data?.subscription?.unsubscribe?.()
  }, [])

  async function handleLogin(u) {
    // Открываем ПЕРСОНАЛЬНУЮ базу пользователя ДО показа экранов (изоляция данных:
    // у каждого своя физическая IndexedDB, чужое в принципе не видно). openUserDb
    // закроет базу предыдущей учетки и перенесет несинхрон. правки со старой общей
    // базы. Чистка кросс-пользовательских кэшей больше не нужна — изоляция физическая.
    await openUserDb(u.id)
    storageSet('localStorage', SESSION_KEY, JSON.stringify({ id: u.id }))
    setUser(u)
    onLoggedIn?.()
  }

  // Имя сменили в ЛК — обновляем профиль в стейте, чтобы шапка и инициал-аватар
  // сразу показали новое имя. Персистить в localStorage не нужно (там только id):
  // новое имя переживет перезапуск через ростер/офлайн-кэш PIN (setName их пишет).
  // Стабильная ссылка: App зовет ее из эффекта сверки имени с кэшем.
  const handleRenamed = useCallback((name) => {
    setUser((u) => (u ? { ...u, name } : u))
  }, [])

  // Выход уже идет (до ~7 с: пуш-подписка + signOut). Второй вызов — no-op,
  // индикацию «Выхожу…» рисует LogoutButton (РЕВЬЮ-КОДА-2026-10-02).
  const logoutRef = useRef(null)
  function handleLogout() {
    if (!logoutRef.current) {
      logoutRef.current = (async () => {
        // Пуши этой учетки на устройство больше не нужны (общий телефон). Пока сессия
        // жива — снимаем подписку и на сервере; никогда не бросает, ждет не дольше 4 с.
        if (user?.id) await releasePushOnLogout(user.id)
        await authLogout()
        storageRemove('localStorage', SESSION_KEY)
        setUser(null)      // сначала размонтируем экраны и их live-queries…
        closeUserDb()      // …затем закрываем персональную базу
      })().finally(() => { logoutRef.current = null })
    }
    return logoutRef.current
  }

  return { user, handleLogin, handleRenamed, handleLogout }
}
