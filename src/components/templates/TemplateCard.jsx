import MuscleTags from '../workout/MuscleTags.jsx'
import Chevron from '../ui/Chevron.jsx'
import CheckIcon from '../ui/CheckIcon.jsx'

export default function TemplateCard({ t, onClick, selectMode = false, picked = false, note }) {
  return (
    <button type="button" className={'card history-card tpl-card history-tap' + (selectMode && picked ? ' picked' : '')}
      onClick={onClick}>
      <span className="history-head">
        <span className="history-date">{t.name}</span>
        {selectMode ? (
          <span className={'history-check' + (picked ? ' on' : '')} aria-hidden="true">
            {picked && <CheckIcon size={16} strokeWidth={3} />}
          </span>
        ) : <Chevron className="history-chevron" />}
      </span>
      {note}
      <MuscleTags entries={t.exercises ?? []} />
    </button>
  )
}
