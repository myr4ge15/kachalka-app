import { useCallback, useEffect, useState } from 'react'
import SheetDialog from '../ui/SheetDialog.jsx'
import { createTgLinkToken, getBotUsername, getRecoveryStatus, LoginError } from '../../lib/auth.js'
import { tgStartLink } from '../../lib/recovery.js'
import { LATER_DELAY_MS, laterLabel, tgLinkDone } from '../../lib/tgLinkPrompt.js'
import { useAliveRef } from '../../hooks/useAliveRef.js'

// «Привяжи Telegram» при запуске (v7.5.0; когда и кому — lib/tgLinkPrompt.js, показ —
// hooks/useLaunchSheets.js). kind: 'relink' — привязан к старому боту, 'link' — не привязан.
// Лист нельзя смахнуть тапом мимо, Escape или кнопкой в шапке: закрывается только
// «Позже», и та оживает через 3 секунды — лист не пролистнешь на автомате.
// Ссылку t.me/<бот>?start=<токен> готовим сразу: Telegram открывается прямо по нажатию
// (асинхронный window.open после запроса iPhone блокирует). Вернулся из Telegram —
// переспрашиваем статус; привязка прошла — лист закрывается сам (onClose('linked')).
// Пропсы: kind, userId, onClose('later' | 'linked').
const TEXT = {
  relink: {
    title: 'Перепривяжи Telegram',
    body: '🔐 Ссылки для сброса PIN теперь присылает отдельный бот. Старая привязка к нему не подходит — привяжи Telegram заново, это секунд десять.',
  },
  link: {
    title: 'Привяжи Telegram',
    body: '🔐 Забудешь PIN — бот пришлет ссылку, и ты задашь новый сам, без админа. Привязка займет секунд десять.',
  },
}

export default function TgLinkSheet({ kind, userId, onClose }) {
  const aliveRef = useAliveRef()
  const [href, setHref] = useState(null)
  const [err, setErr] = useState('')
  const [opened, setOpened] = useState(false)
  const [left, setLeft] = useState(LATER_DELAY_MS)
  const text = TEXT[kind] ?? TEXT.link

  const prepare = useCallback(async () => {
    setErr('')
    try {
      const [username, token] = await Promise.all([getBotUsername(), createTgLinkToken(userId)])
      const link = tgStartLink(username, token)
      if (!link) throw new LoginError('server', 'Бот сейчас недоступен — попробуй позже.')
      if (aliveRef.current) setHref(link)
    } catch (e) {
      if (aliveRef.current) setErr(e instanceof LoginError ? e.message : 'Не получилось подготовить ссылку.')
    }
  }, [userId, aliveRef])
  useEffect(() => { prepare() }, [prepare])

  // «Позже» — через 3 секунды, с отсчетом на кнопке.
  useEffect(() => {
    if (left <= 0) return undefined
    const t = setTimeout(() => setLeft((ms) => Math.max(0, ms - 1000)), 1000)
    return () => clearTimeout(t)
  }, [left])

  // После перехода в Telegram: вкладка снова видна — проверить, привязался ли.
  useEffect(() => {
    if (!opened) return undefined
    const check = async () => {
      if (document.hidden) return
      try {
        const s = await getRecoveryStatus(userId)
        if (aliveRef.current && tgLinkDone(s)) onClose?.('linked')
      } catch { /* нет сети — спросим при следующем возвращении */ }
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [opened, userId, aliveRef, onClose])

  const laterReady = left <= 0
  return (
    <SheetDialog title={text.title} actionLabel={null} onDismiss={() => {}} className="sheet--compact">
      <p className="push-ask-text">{text.body}</p>
      {err && <p className="push-err" role="alert">{err}</p>}
      {href ? (
        <a
          className="btn primary full"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setOpened(true)}
          data-autofocus
        >
          {opened ? 'Открыть бота еще раз' : 'Привязать Telegram'}
        </a>
      ) : err ? (
        <button type="button" className="btn primary full" onClick={prepare}>Попробовать снова</button>
      ) : (
        <button type="button" className="btn primary full" disabled>Готовлю ссылку…</button>
      )}
      {opened && (
        <p className="push-ask-hint" role="status">В боте нажми «Старт» и возвращайся — я проверю сам.</p>
      )}
      <button
        type="button"
        className="link-btn push-ask-later"
        onClick={() => onClose?.('later')}
        disabled={!laterReady}
        aria-label={laterReady ? 'Позже' : `Позже, через ${Math.ceil(left / 1000)} с`}
      >
        {laterLabel(left)}
        {/* Полоска под кнопкой заполняется за те же 3 секунды — видно, что «Позже» ждет таймер. */}
        {!laterReady && <span className="later-bar" aria-hidden="true" />}
      </button>
      <p className="push-ask-hint">
        {kind === 'relink' ? 'Напомню при следующем запуске.' : 'Напомню через 3 дня.'} Привязать можно и в Профиле → Настройки → «Восстановление доступа».
      </p>
    </SheetDialog>
  )
}
