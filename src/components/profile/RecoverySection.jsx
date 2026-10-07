import { useCallback, useEffect, useState } from 'react'
import {
  getRecoveryStatus, createRecoveryCode, createTgLinkToken, unlinkTg, getBotUsername, LoginError,
} from '../../lib/auth.js'
import { tgStartLink } from '../../lib/recovery.js'
import { fmtDate } from '../../lib/dates.js'
import RecoveryCodeView from '../recovery/RecoveryCodeView.jsx'
import { showToast } from '../Toast.jsx'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import { useAliveRef } from '../../hooks/useAliveRef.js'

// «🔐 Восстановление доступа» в Настройках (П1 «Мой круг», 07.10.2026): как вернуть
// вход, если забыл PIN, без админа. Только онлайн (статус — на сервере).
//   • Telegram: «Привязать» → одноразовая ссылка t.me/<бот>?start=… (10 мин) → в боте
//     «Старт». «Отвязать» — здесь или /stop в боте.
//   • Код восстановления: «Новый код» — показывается один раз, прежний сгорает.
export default function RecoverySection({ userId }) {
  const aliveRef = useAliveRef()
  const [open, setOpen] = useState(false)
  const boxRef = useRevealFocus(open)
  const [status, setStatus] = useState(null) // null — еще не знаем
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('') // '' | 'link' | 'unlink' | 'code'
  const [tgLink, setTgLink] = useState(null)
  const [code, setCode] = useState(null)
  const [confirmCode, setConfirmCode] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(false)

  const refresh = useCallback(async () => {
    if (!navigator.onLine) { setErr('Виден онлайн.'); return }
    try {
      const s = await getRecoveryStatus(userId)
      if (!aliveRef.current) return
      setStatus(s); setErr('')
      if (s.tgLinked) setTgLink(null)
    } catch (e) {
      if (aliveRef.current) setErr(e instanceof LoginError ? e.message : 'Не удалось узнать статус.')
    }
  }, [userId, aliveRef])

  // Раскрыто — статус; вернулся из Telegram (вкладка снова видна) — переспросить.
  useEffect(() => {
    if (!open) return undefined
    refresh()
    const onVis = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [open, refresh])

  async function run(kind, fn) {
    setBusy(kind); setErr('')
    try { await fn() } catch (e) {
      if (aliveRef.current) setErr(e instanceof LoginError ? e.message : 'Не получилось — попробуй позже.')
    } finally {
      if (aliveRef.current) setBusy('')
    }
  }

  const prepareLink = () => run('link', async () => {
    const [username, token] = await Promise.all([getBotUsername(), createTgLinkToken(userId)])
    const href = tgStartLink(username, token)
    if (!href) throw new LoginError('server', 'Бот сейчас недоступен — попробуй позже.')
    if (aliveRef.current) setTgLink(href)
  })

  const doUnlink = () => {
    if (!confirmUnlink) { setConfirmUnlink(true); return }
    run('unlink', async () => {
      await unlinkTg(userId)
      if (!aliveRef.current) return
      setConfirmUnlink(false)
      showToast({ emoji: '🔐', title: 'Telegram отвязан' })
      await refresh()
    })
  }

  const newCode = () => {
    if (status?.hasCode && !confirmCode) { setConfirmCode(true); return }
    run('code', async () => {
      const c = await createRecoveryCode(userId)
      if (!aliveRef.current) return
      setConfirmCode(false); setCode(c)
    })
  }

  if (!open) {
    return (
      <button className="act" onClick={() => setOpen(true)}>
        <span className="act-txt">
          🔐 Восстановление доступа
          <span className="act-sub">если забудешь PIN</span>
        </span>
      </button>
    )
  }

  if (code) {
    return (
      <div className="pin-form" ref={boxRef}>
        <RecoveryCodeView code={code} onDone={() => { setCode(null); refresh() }} />
      </div>
    )
  }

  const since = (iso) => (iso ? ` с ${fmtDate(iso)}` : '')
  return (
    <div className="pin-form recovery-box" ref={boxRef}>
      <p className="pin-form-title">Восстановление доступа</p>
      <p className="muted invite-note">Забудешь PIN — на экране входа нажми «Забыл PIN?» и войди одним из способов.</p>

      <p className="recovery-row-title">Telegram</p>
      {status === null ? (
        <p className="muted" role="status">{err ? '' : 'Проверяю…'}</p>
      ) : status.tgLinked ? (
        <>
          <p className="recovery-state" data-testid="tg-state">✅ Привязан{since(status.tgLinkedAt)} — бот пришлет ссылку для нового PIN.</p>
          <button type="button" className={confirmUnlink ? 'link-btn danger' : 'link-btn'} disabled={!!busy} onClick={doUnlink}>
            {busy === 'unlink' ? 'Отвязываю…' : confirmUnlink ? 'Точно отвязать?' : 'Отвязать'}
          </button>
        </>
      ) : tgLink ? (
        <>
          <a className="btn primary" href={tgLink} target="_blank" rel="noopener noreferrer">Открыть бота в Telegram</a>
          <p className="muted invite-note">В боте нажми «Старт». Ссылка действует 10 минут, потом вернись сюда.</p>
        </>
      ) : (
        <>
          <p className="recovery-state" data-testid="tg-state">Не привязан</p>
          <button type="button" className="btn ghost" disabled={!!busy} onClick={prepareLink}>
            {busy === 'link' ? 'Готовлю ссылку…' : 'Привязать Telegram'}
          </button>
        </>
      )}

      <p className="recovery-row-title">Код восстановления</p>
      {status !== null && (
        <p className="recovery-state" data-testid="code-state">
          {status.hasCode ? `✅ Есть${since(status.codeCreatedAt)}. Сам код не хранится — только у тебя.` : 'Нет кода'}
        </p>
      )}
      {confirmCode && <p className="muted invite-note">Прежний код перестанет действовать.</p>}
      <button type="button" className="btn ghost" disabled={!!busy || status === null} onClick={newCode}>
        {busy === 'code' ? 'Выпускаю…' : confirmCode ? 'Да, выпустить новый' : status?.hasCode ? 'Новый код' : 'Получить код'}
      </button>

      {err && <p className="pin-err" role="alert">{err}</p>}
      <div className="pin-form-actions">
        <button type="button" className="btn ghost" onClick={() => { setOpen(false); setTgLink(null); setConfirmCode(false); setConfirmUnlink(false) }}>Свернуть</button>
      </div>
    </div>
  )
}
