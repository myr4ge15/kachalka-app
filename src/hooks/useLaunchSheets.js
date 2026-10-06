import { useEffect, useRef, useState } from 'react'
import { getPushState, wasPushAsked, markPushAsked } from '../db/push.js'
import { shouldAskPush } from '../lib/pushSupport.js'
import { readStoredUserId } from '../lib/sessionProfile.js'
import { storageGet } from '../lib/safeStorage.js'
import { showToast } from '../components/Toast.jsx'
import { WHATS_NEW } from '../content/whatsNew.js'
import { pendingWhatsNew, mergeForSheet, readMark, writeMark, SEEN_KEY } from '../lib/whatsNew.js'
import { SESSION_KEY } from './useSession.js'

// Листы после входа/обновления (вынесено из App.jsx в v6.14.1, код — дословно):
// «Что нового» и разовый вопрос «Включить уведомления?». Вопрос ждет, пока лист
// закрыт и человек не пишет тренировку (historyBusy).
// Возвращает { whatsNew, closeWhatsNew, pushAsk, closePushAsk }.
export function useLaunchSheets(user, historyBusy) {
  // «Что нового» (v6.4.0): лист один раз после обновления. knownDevice — сессия
  // была ДО запуска (тут уже входили): тогда при пустой отметке покажем свежую
  // запись, а новичку/новому телефону — молча запомним версию (lib/whatsNew.js).
  const knownDeviceRef = useRef(null)
  if (knownDeviceRef.current === null) {
    knownDeviceRef.current = Boolean(readStoredUserId(storageGet('localStorage', SESSION_KEY)))
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
  // Разовый вопрос «Включить уведомления?» (v6.6.1): после входа/обновления, когда
  // лист «Что нового» уже закрыт и человек не пишет тренировку. Один раз на учетку
  // на этом устройстве; «Не сейчас» — больше не спрашиваем (есть тумблер в Настройках).
  const [pushAsk, setPushAsk] = useState(false)
  useEffect(() => {
    if (!user?.id || whatsNew || historyBusy || pushAsk) return
    if (wasPushAsked(user.id)) return
    let alive = true
    const t = setTimeout(async () => {
      try {
        const s = await getPushState(user.id)
        if (alive && shouldAskPush({ ...s, asked: wasPushAsked(user.id) })) setPushAsk(true)
      } catch { /* не спросим сейчас — спросим при следующем запуске */ }
    }, 1200)
    return () => { alive = false; clearTimeout(t) }
  }, [user?.id, whatsNew, historyBusy, pushAsk])
  function closePushAsk(enabled) {
    if (user?.id) markPushAsked(user.id)
    setPushAsk(false)
    if (enabled) showToast({ emoji: '🔔', title: 'Уведомления включены' })
  }

  return { whatsNew, closeWhatsNew, pushAsk, closePushAsk }
}
