import { useEffect, useState } from 'react'
import BackButton from '../components/BackButton.jsx'
import WhatsNewItems from '../components/WhatsNewItems.jsx'
import { WHATS_NEW } from '../content/whatsNew.js'
import { fmtWhatsNewDate, OPENED_KEY, writeMark } from '../lib/whatsNew.js'

// Экран «Обновления» (v6.4.0, Профиль → Настройки → «Что нового», или тап по версии
// внизу Настроек). Одна запись на день; свежая раскрыта, прошлые — одной строкой
// (тап раскрывает). Открытие гасит метку «новое» в Настройках.
// Пропсы: onBack(), [entries] — для тестов.
export default function WhatsNewScreen({ onBack, entries = WHATS_NEW }) {
  const [open, setOpen] = useState(() => new Set(entries[0] ? [entries[0].version] : []))
  useEffect(() => {
    if (entries[0]) writeMark(OPENED_KEY, entries[0].version)
  }, [entries])
  const toggle = (v) => setOpen((cur) => {
    const next = new Set(cur)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    return next
  })

  return (
    <div className="screen whats-new-screen">
      <div className="admin-head">
        <BackButton onClick={onBack} />
        <h2 className="admin-title">Обновления</h2>
      </div>
      {entries.map((e, i) => {
        const isOpen = open.has(e.version)
        return (
          <section key={e.version} className={'wn-rel' + (i === 0 ? ' new' : '') + (isOpen ? ' open' : '')}>
            <button type="button" className="wn-rel-h" onClick={() => toggle(e.version)} aria-expanded={isOpen}>
              <span className="wn-rel-v">
                {e.version}
                {e.big && <span className="wn-big">большое</span>}
              </span>
              <span className="wn-rel-d">{fmtWhatsNewDate(e.date)}</span>
            </button>
            {isOpen ? (
              <>
                <WhatsNewItems items={e.main} />
                {e.minor?.length > 0 && <WhatsNewItems items={e.minor} compact />}
              </>
            ) : (
              <p className="wn-rel-sub">{e.main[0]?.e} {e.headline ?? e.main[0]?.t}</p>
            )}
          </section>
        )
      })}
      <p className="muted wn-older">Раньше — в чате в Телеграме</p>
    </div>
  )
}
