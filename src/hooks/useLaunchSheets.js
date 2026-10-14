import { useEffect, useRef, useState } from 'react'
import { getPushState, wasPushAsked, markPushAsked } from '../db/push.js'
import { shouldAskPush } from '../lib/pushSupport.js'
import { readStoredUserId } from '../lib/sessionProfile.js'
import { storageGet, storageSet } from '../lib/safeStorage.js'
import { getBotInfo, getRecoveryStatus } from '../lib/auth.js'
import { shouldShowTgPrompt, SNOOZE_MS, snoozeKey, tgPromptKind } from '../lib/tgLinkPrompt.js'
import { showToast } from '../components/ui/Toast.jsx'
import { WHATS_NEW } from '../content/whatsNew.js'
import { pendingWhatsNew, mergeForSheet, readMark, writeMark, SEEN_KEY } from '../lib/whatsNew.js'
import { SESSION_KEY } from './useSession.js'
import { isWelcomePending, markWelcomeDone } from '../lib/welcome.js'

// Листы после входа/обновления (вынесено из App.jsx в v6.14.1, код — дословно):
// «Добро пожаловать» (v6.15.0, только новичку после регистрации), «Что нового» и
// разовый вопрос «Включить уведомления?». Вопрос ждет, пока листы закрыты и
// человек не пишет тренировку (historyBusy).
// v7.5.0 — «Привяжи Telegram» (сброс PIN переехал в отдельного бота): после «Что
// нового», раньше вопроса про пуши.
// Возвращает { welcome, closeWelcome, whatsNew, closeWhatsNew, tgAsk, closeTgAsk, pushAsk, closePushAsk }.
export function useLaunchSheets(user, historyBusy) {
  // «Что нового» (v6.4.0): лист один раз после обновления. knownDevice — сессия
  // была ДО запуска (тут уже входили): тогда при пустой отметке покажем свежую
  // запись, а новичку/новому телефону — молча запомним версию (lib/whatsNew.js).
  const knownDeviceRef = useRef(null)
  if (knownDeviceRef.current === null) {
    knownDeviceRef.current = Boolean(readStoredUserId(storageGet('localStorage', SESSION_KEY)))
  }
  // «Добро пожаловать» (v6.15.0): отметку «pending» ставит регистрация по
  // приглашению (App → markWelcomePending), закрытие листа — «done».
  const [welcome, setWelcome] = useState(false)
  useEffect(() => { setWelcome(isWelcomePending(user?.id)) }, [user?.id])
  function closeWelcome() {
    markWelcomeDone(user?.id)
    setWelcome(false)
  }
  const [whatsNew, setWhatsNew] = useState(null)
  useEffect(() => {
    if (!user?.id) return
    const { show, markSeen } = pendingWhatsNew(WHATS_NEW, readMark(SEEN_KEY), __APP_VERSION__, {
      knownDevice: knownDeviceRef.current,
    })
    if (markSeen) writeMark(SEEN_KEY, markSeen)
    setWhatsNew(mergeForSheet(show))
  }, [user?.id])
  function closeWhatsNew() {
    writeMark(SEEN_KEY, __APP_VERSION__)
    setWhatsNew(null)
  }
  // «Привяжи Telegram» (v7.5.0, lib/tgLinkPrompt.js): раз за запуск — проверяем статус
  // привязки и бота, когда остальные листы закрыты и человек не пишет тренировку. Только
  // онлайн; сбой сети — молча, спросим при следующем запуске. tgAsk — 'relink' | 'link' | null.
  const [tgAsk, setTgAsk] = useState(null)
  const tgCheckedRef = useRef(null)
  useEffect(() => {
    if (!user?.id || welcome || whatsNew || historyBusy || tgCheckedRef.current === user.id) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    let alive = true
    const t = setTimeout(async () => {
      tgCheckedRef.current = user.id
      try {
        const [bot, status] = await Promise.all([getBotInfo(), getRecoveryStatus(user.id)])
        const kind = tgPromptKind(status, bot)
        if (alive && shouldShowTgPrompt(kind, storageGet('localStorage', snoozeKey(user.id)))) setTgAsk(kind)
      } catch { /* без сети/сессии — спросим при следующем запуске */ }
    }, 600)
    return () => { alive = false; clearTimeout(t) }
  }, [user?.id, welcome, whatsNew, historyBusy])
  function closeTgAsk(result) {
    if (result === 'later' && tgAsk === 'link' && user?.id) {
      storageSet('localStorage', snoozeKey(user.id), String(Date.now() + SNOOZE_MS))
    }
    setTgAsk(null)
    if (result === 'linked') showToast({ emoji: '✅', title: 'Telegram привязан' })
  }

  // Разовый вопрос «Включить уведомления?» (v6.6.1): после входа/обновления, когда
  // лист «Что нового» уже закрыт и человек не пишет тренировку. Один раз на учетку
  // на этом устройстве; «Не сейчас» — больше не спрашиваем (есть тумблер в Настройках).
  const [pushAsk, setPushAsk] = useState(false)
  useEffect(() => {
    if (!user?.id || welcome || whatsNew || tgAsk || historyBusy || pushAsk) return
    if (wasPushAsked(user.id)) return
    let alive = true
    const t = setTimeout(async () => {
      try {
        const s = await getPushState(user.id)
        if (alive && shouldAskPush({ ...s, asked: wasPushAsked(user.id) })) setPushAsk(true)
      } catch { /* не спросим сейчас — спросим при следующем запуске */ }
    }, 1200)
    return () => { alive = false; clearTimeout(t) }
  }, [user?.id, welcome, whatsNew, tgAsk, historyBusy, pushAsk])
  function closePushAsk(enabled) {
    if (user?.id) markPushAsked(user.id)
    setPushAsk(false)
    if (enabled) showToast({ emoji: '🔔', title: 'Уведомления включены' })
  }

  return { welcome, closeWelcome, whatsNew, closeWhatsNew, tgAsk, closeTgAsk, pushAsk, closePushAsk }
}
