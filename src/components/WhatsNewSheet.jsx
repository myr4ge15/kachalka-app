import { plural } from '../lib/plural.js'
import { useState } from 'react'
import SheetDialog from './SheetDialog.jsx'
import WhatsNewItems from './WhatsNewItems.jsx'
import { fmtWhatsNewDate } from '../lib/whatsNew.js'

// Лист «Что нового» (v6.4.0, вариант A из prototypes/whats-new.html): один раз
// после обновления — 3–4 главных пункта, «еще N мелочей» по тапу, «Понятно».
// Несколько пропущенных релизов уже сведены в один `release` (lib/whatsNew.js
// mergeForSheet). Пропсы: release, onDone(), onOpenAll().
export default function WhatsNewSheet({ release, onDone, onOpenAll }) {
  const [showMinor, setShowMinor] = useState(false)
  if (!release) return null
  const minor = release.minor ?? []
  return (
    <SheetDialog title="Что нового" actionLabel="закрыть" onDismiss={onDone} className="sheet--compact">
      <p className="wn-kicker">
        <span className="wn-ver">v{release.version}</span>
        {fmtWhatsNewDate(release.date)}
        {release.count > 1 ? ` · за ${release.count} ${plural(release.count, 'обновление', 'обновления', 'обновлений')}` : ''}
      </p>
      <div className="sheet-scroll">
        <WhatsNewItems items={release.main} />
        {minor.length > 0 && (showMinor ? (
          <WhatsNewItems items={minor} compact />
        ) : (
          <button type="button" className="wn-more" onClick={() => setShowMinor(true)}>
            <span>И еще {minor.length} {minorWord(minor.length)}</span>
            <span className="wn-more-go">Показать ›</span>
          </button>
        ))}
      </div>
      <button type="button" className="btn primary full wn-ok" onClick={onDone} data-autofocus>
        Понятно
      </button>
      <button type="button" className="link-btn wn-all" onClick={onOpenAll}>Все обновления</button>
    </SheetDialog>
  )
}

function minorWord(n) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'мелочь'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'мелочи'
  return 'мелочей'
}
