// ============================================================================
// Веб-пуши (v6.6.0): подписка ЭТОГО браузера на уведомления и её привязка к
// учетке на сервере. Чистая логика — в lib/pushSupport.js; сервер —
// supabase/push.sql (push_subscribe/push_unsubscribe, владелец — app_uid()).
//
// Почему не через очереди sync.js: подписка — свойство устройства, а не данные
// пользователя. Без сети ее не получить вовсе (браузер регистрирует ее у
// push-сервиса онлайн), так что офлайн-очередь здесь ничего не дает. Это
// прямой RPC, как смена имени/пола в lib/auth.js, только онлайн.
//
// Пуши ловит тот же service worker, что и обновления (Workbox + public/push-sw.js
// через importScripts в vite.config.js).
// ============================================================================
import { supabase, hasSession } from './supabase.js'
import { ensureOwnSession } from '../lib/auth.js'
import { withTimeout } from '../lib/withTimeout.js'
import { pushAvailability, desktopAvailability, DESKTOP_QUERY, isIOSDevice, urlB64ToUint8Array, subscriptionArgs, isStaleServerKey } from '../lib/pushSupport.js'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

export class PushError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PushError'
  }
}

function browserFacts() {
  const nav = typeof navigator !== 'undefined' ? navigator : {}
  const win = typeof window !== 'undefined' ? window : {}
  const supported =
    'serviceWorker' in nav && 'PushManager' in win && 'Notification' in win
  const standalone =
    (typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches) ||
    nav.standalone === true
  return {
    configured: Boolean(VAPID_PUBLIC_KEY),
    supported,
    isIOS: isIOSDevice(nav),
    standalone,
    desktop: typeof win.matchMedia === 'function' && win.matchMedia(DESKTOP_QUERY).matches,
    permission: supported ? win.Notification.permission : 'default',
  }
}

// Регистрация service worker без ожидания `ready`: в dev-режиме (vite без SW)
// `ready` не наступает никогда, и экран висел бы. Нет регистрации — нет пушей.
async function registration() {
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null
  } catch {
    return null
  }
}

async function currentSubscription() {
  const reg = await registration()
  if (!reg?.pushManager) return { reg, sub: null }
  try {
    return { reg, sub: await reg.pushManager.getSubscription() }
  } catch {
    return { reg, sub: null }
  }
}

// ЧЬЯ подписка браузера (РЕВЬЮ-КОДА-2026-10-02, п. 9). Подписка у браузера одна, а
// учеток на общем телефоне несколько: сервер привязывает endpoint к одной из них.
// Раньше перепривязка шла только из Настроек, и после входа другой учетки на
// устройство продолжали приходить пуши прежней («реакция на ТВОЮ тренировку» —
// не тому человеку). Теперь владелец подписки записан на устройстве, а при входе
// чужая подписка снимается. «Хочу пуши» — отдельно на учетку: выход из учетки не
// означает «больше не присылать», поэтому при следующем входе подписка
// восстанавливается сама (если разрешение браузера уже выдано).
const OWNER_KEY = 'gym_app_push_owner'
const wantedKey = (userId) => `gym_app_push_wanted_${userId}`
function store() {
  try { return globalThis.localStorage ?? null } catch { return null }
}
function getOwner() {
  try { return store()?.getItem(OWNER_KEY) ?? null } catch { return null }
}
function setOwner(userId) {
  try { store()?.setItem(OWNER_KEY, String(userId)) } catch { /* приватный режим */ }
}
function clearOwner() {
  try { store()?.removeItem(OWNER_KEY) } catch { /* нечего чистить */ }
}
function isWanted(userId) {
  try { return store()?.getItem(wantedKey(userId)) === '1' } catch { return false }
}
function setWanted(userId, on) {
  try {
    if (on) store()?.setItem(wantedKey(userId), '1')
    else store()?.removeItem(wantedKey(userId))
  } catch { /* приватный режим */ }
}

// Подписка под старый VAPID-ключ (ключ сборки сменили) — снимаем, чтобы вызывающий
// подписался заново под текущий: push-сервис такую отвергает, пуши не доходят.
// Ключ подписки неизвестен (старый браузер) — оставляем как есть (см. isStaleServerKey).
async function dropIfStaleKey(sub) {
  if (!sub || !VAPID_PUBLIC_KEY) return sub
  let expected
  try { expected = urlB64ToUint8Array(VAPID_PUBLIC_KEY) } catch { return sub }
  if (!isStaleServerKey(sub.options?.applicationServerKey, expected)) return sub
  await sub.unsubscribe().catch(() => {})
  return null
}

async function saveOnServer(sub) {
  const args = subscriptionArgs(sub?.toJSON?.(), navigator.userAgent)
  if (!args) throw new PushError('Браузер выдал неполную подписку — попробуй еще раз.')
  let res
  try {
    res = await withTimeout(supabase.rpc('push_subscribe', args))
  } catch {
    throw new PushError('Нет сети — попробуй позже.')
  }
  if (res.error) throw new PushError('Сервер не сохранил подписку. Попробуй позже.')
}

// Состояние для Настроек: { availability, enabled, permission }. enabled — у браузера есть
// подписка и разрешение. Если подписка есть, тихо подтверждаем ее на сервере
// (холостой повтор ничего не пишет): так сервер догоняет браузер, если подписку
// перехватила другая учетка на общем телефоне или ее вычистили.
export async function getPushState(userId) {
  const facts = browserFacts()
  const { permission } = facts
  const availability = pushAvailability(facts)
  const { desktop } = facts
  if (availability !== 'ok') return { availability: desktopAvailability(availability, { desktop }), enabled: false, permission }
  const { reg, sub } = await currentSubscription()
  if (!reg) return { availability: desktopAvailability('unsupported', { desktop }), enabled: false, permission }
  // Подписка другой учетки этого устройства — не «включено» для текущей и не
  // перепривязываем ее молча (включит тумблером — тогда заберет себе).
  const owner = getOwner()
  const mine = !owner || owner === String(userId)
  const enabled = Boolean(sub) && facts.permission === 'granted' && mine
  if (enabled && navigator.onLine && (await hasSession(userId))) {
    if (!owner) setOwner(userId)
    saveOnServer(sub).catch(() => { /* не критично: повторим при следующем открытии */ })
  }
  return { availability: desktopAvailability(availability, { desktop, enabled }), enabled, permission }
}

// Включить: разрешение → подписка браузера → привязка на сервере. Разрешение
// спрашиваем ПЕРВЫМ делом — Safari показывает запрос только в ответ на нажатие,
// а после долгих await жест считается «остывшим».
export async function enablePush(userId) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new PushError(permission === 'denied'
      ? 'Уведомления запрещены — разреши их в настройках браузера или телефона.'
      : 'Разрешение не выдано.')
  }
  if (!navigator.onLine) throw new PushError('Включить уведомления можно только онлайн.')
  const reg = await registration()
  if (!reg?.pushManager) throw new PushError('Этот браузер не умеет пуш-уведомления.')

  let sub
  try {
    sub = (await dropIfStaleKey(await reg.pushManager.getSubscription())) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY),
      }))
  } catch {
    throw new PushError('Браузер не дал подписаться на уведомления. Попробуй еще раз.')
  }

  try {
    await ensureOwnSession(userId)
    await saveOnServer(sub)
    setOwner(userId)
    setWanted(userId, true)
  } catch (e) {
    // Сервер о подписке не знает — не оставляем браузер «включенным» впустую.
    await sub.unsubscribe().catch(() => {})
    throw e instanceof PushError ? e : new PushError(e?.message || 'Не удалось включить уведомления.')
  }
}

// Выключить: сначала снимаем подписку в браузере (работает и офлайн — дальше
// push-сервис ответит серверу «подписки нет», и та сотрется сама), затем
// по возможности убираем ее на сервере. background: true (тумблер в Настройках,
// v6.7.1) — серверную чистку не ждем: пуши на устройство уже не придут, а ждать
// просыпающийся сервер до 5 с незачем. Выход из учетки ждет (сессия вот-вот уйдет).
//
// forget: true (тумблер «выкл») — человек больше не хочет пушей; false (выход из
// учетки) — подписку снимаем, но при следующем входе восстановим.
export async function disablePush(userId, { background = false, forget = true } = {}) {
  if (forget) setWanted(userId, false)
  const { sub } = await currentSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => {})
  clearOwner()
  const cleanup = (async () => {
    if (!navigator.onLine || !(await hasSession(userId))) return
    try {
      await withTimeout(supabase.rpc('push_unsubscribe', { p_endpoint: endpoint }), 5000)
    } catch { /* сервер дочистит по ответу push-сервиса */ }
  })()
  if (!background) await cleanup
}

// Выход из учетки: уведомления этого человека больше не должны приходить на
// устройство (общий телефон). Никогда не бросает и не задерживает выход надолго.
//
// v6.7.7: подписку в БРАУЗЕРЕ при выходе не снимаем — только отвязываем на сервере.
// В 6.7.5–6.7.6 выход снимал ее целиком, а вернуть при повторном входе удавалось не
// всегда: у тех, кто включал пуши до 6.7.5, не было отметки «хочет пуши», а iOS
// может не дать подписаться заново без нажатия пользователя. Итог — после
// выхода/входа уведомления молча выключались. Теперь:
//  - вошел тот же человек — та же подписка снова привязывается к нему
//    (reconcilePushOwner, без участия iOS);
//  - вошел другой — подписка прежнего владельца снимается там же;
//  - пока никто не вошел, сервер ее не знает — пуши на устройство не идут.
export async function releasePushOnLogout(userId) {
  try {
    await withTimeout(unbindOnServer(userId), 4000)
  } catch { /* выход важнее */ }
}

async function unbindOnServer(userId) {
  const { sub } = await currentSubscription()
  if (!sub) return
  // Владелец должен быть записан ДО выхода: иначе следующая учетка «усыновила» бы
  // подписку без владельца (так жили подписки до 6.7.5).
  if (!getOwner()) setOwner(userId)
  if (getOwner() !== String(userId)) return
  setWanted(userId, true) // подписка была — значит, человек пуши хотел
  if (!navigator.onLine || !(await hasSession(userId))) return
  try {
    await withTimeout(supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint }), 5000)
  } catch { /* не вышло — снимем при входе другой учетки */ }
}

// Сверка подписки при входе и восстановлении сессии. Никогда не бросает.
//  - подписка чужой учетки этого устройства → снимаем в браузере (без сети тоже:
//    push-сервис ответит серверу «подписки нет», и строка сотрется сама);
//  - своя → подтверждаем на сервере (сервер мог перепривязать endpoint к другой
//    учетке, пока она была активна);
//  - подписки нет, а человек пуши хотел и разрешение уже выдано → подписываем
//    заново (выход из учетки снимал подписку).
// Серверная часть — только под своей сессией; без нее вызов повторят, когда
// сессия поднимется (App слушает onAuthStateChange).
export async function reconcilePushOwner(userId) {
  try {
    if (!userId) return
    const facts = browserFacts()
    if (!facts.supported) return
    const reg = await registration()
    if (!reg?.pushManager) return
    let sub = null
    try { sub = await reg.pushManager.getSubscription() } catch { sub = null }
    const owner = getOwner()
    if (sub && owner && owner !== String(userId)) {
      await sub.unsubscribe().catch(() => {})
      clearOwner()
      sub = null
    }
    if (!navigator.onLine || !(await hasSession(userId))) return
    // Своя подписка под старый VAPID-ключ — снимаем и подписываемся заново ниже:
    // раз подписка была, пуши человек хотел (флага wanted у подписок до v6.7.5 нет).
    let resubscribe = false
    if (sub && facts.permission === 'granted' && facts.configured) {
      const kept = await dropIfStaleKey(sub)
      if (!kept) { sub = null; resubscribe = true }
    }
    if (sub) {
      if (facts.permission !== 'granted') return
      await saveOnServer(sub)
      setOwner(userId)
      // Подписки до 6.7.5 жили без отметки «хочет пуши» — ставим ее по факту.
      setWanted(userId, true)
      return
    }
    if (!(resubscribe || isWanted(userId)) || facts.permission !== 'granted' || !facts.configured) return
    const fresh = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY),
    })
    try {
      await saveOnServer(fresh)
      setOwner(userId)
    } catch (e) {
      await fresh.unsubscribe().catch(() => {})
      throw e
    }
  } catch { /* пуши не критичны: сверим при следующем входе */ }
}

// Разовый вопрос «Включить уведомления?» (v6.6.1): отметка «уже спрашивали» —
// на устройство и учетку, в localStorage. Это не данные человека, а факт про этот
// браузер (разрешение тоже живет в браузере), поэтому в синк не идет.
const askedKey = (userId) => `gym_app_push_asked_${userId}`

export function wasPushAsked(userId) {
  try { return localStorage.getItem(askedKey(userId)) === '1' } catch { return true }
}

export function markPushAsked(userId) {
  try { localStorage.setItem(askedKey(userId), '1') } catch { /* приватный режим — спросим еще раз */ }
}

// Настройки «какие пуши присылать» (v6.7.0) — на сервере, потому что фильтрует
// их отправитель. get_push_prefs/set_push_pref (supabase/push-types.sql),
// владелец — app_uid(). Только онлайн и под своей сессией, как смена имени.
export async function getPushPrefs(userId) {
  if (!navigator.onLine) throw new PushError('Настройки загрузятся, когда появится сеть.')
  if (!(await hasSession(userId))) throw new PushError('Нет связи с сервером под твоей учеткой.')
  let res
  try {
    res = await withTimeout(supabase.rpc('get_push_prefs'), 10000)
  } catch {
    throw new PushError('Настройки загрузятся, когда появится сеть.')
  }
  if (res.error) throw new PushError('Не удалось загрузить настройки уведомлений.')
  return res.data ?? {}
}

export async function setPushPref(userId, type, on) {
  if (!navigator.onLine) throw new PushError('Нет сети — попробуй позже.')
  await ensureOwnSession(userId)
  let res
  try {
    res = await withTimeout(supabase.rpc('set_push_pref', { p_type: type, p_on: Boolean(on) }))
  } catch {
    throw new PushError('Нет сети — попробуй позже.')
  }
  if (res.error) throw new PushError('Не удалось сохранить. Попробуй позже.')
  return res.data ?? {}
}
