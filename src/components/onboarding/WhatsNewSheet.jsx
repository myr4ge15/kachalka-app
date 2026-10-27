import Chevron from '../ui/Chevron.jsx'
import { plural } from '../../lib/plural.js'
import { useState } from 'react'
import SheetDialog from '../ui/SheetDialog.jsx'
import WhatsNewItems from './WhatsNewItems.jsx'
import { fmtWhatsNewDate } from '../../lib/whatsNew.js'

// Лист «Что нового» (v6.4.0, вариант A из prototypes/whats-new.html): один раз
// после обновления — 3–4 главных пункта, «еще N мелочей» по тапу, «Понятно».
// Несколько пропущенных релизов уже сведены в один `release` (lib/whatsNew.js
// mergeForSheet). Пропсы: release, onDone(), onOpenAll().
export default function WhatsNewSheet({ release, onDone, onOpenAll }) {
  const [showMinor, setShowMinor] = useState(false)
  if (!release) return null
  const minor = release.minor ?? []
  return (
    <SheetDialog title="Что нового" actionLabel="закрыть" onDismiss={onDone} swipeDown className="sheet--compact">
      <p className="wn-kicker">
        <span className="wn-ver version-number">v{release.version}</span>
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
            <span className="wn-more-go">Показать <Chevron inline size={16} /></span>
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

// Склонение — общее lib/plural.js (UI-ревью 23.10: была своя копия).
const minorWord = (n) => plural(n, 'мелочь', 'мелочи', 'мелочей')
