// Статус синхронизации + колокольчик (шапка и сайдбар; вынесено из App.jsx, v6.14.1).
import { useSyncStatus } from '../db/sync.js'
import { syncBadgeState } from '../lib/syncStatus.js'
import { useSpinPhase } from '../hooks/useSpinPhase.js'

// Иконка состояния синхронизации — инлайн-SVG (без зависимостей), как TabIcon.
// Красится через currentColor (цвет задает класс .sync-badge.<cls>), спиннер
// крутит CSS (.sync-ico.spin).
function SyncIcon({ name }) {
  const spinStyle = useSpinPhase(name === 'syncing')
  const p = {
    className: name === 'syncing' ? 'sync-ico spin' : 'sync-ico',
    style: spinStyle,
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
  }
  if (name === 'ok') return <svg {...p}><path d="M4 12.5l5 5L20 6" /></svg>
  if (name === 'syncing') return <svg {...p}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 4v5h-5" /></svg>
  if (name === 'pending') return <svg {...p}><path d="M12 19V6" /><path d="M6 11l6-6 6 6" /></svg>
  if (name === 'offline') return (
    <svg {...p}>
      <path d="M6.657 18c-2.572 0-4.657-2.007-4.657-4.483 0-2.475 2.085-4.482 4.657-4.482.393-1.762 1.794-3.2 3.675-3.773 1.88-.572 3.956-.193 5.444 1 1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.483 0 1.921-1.551 3.481-3.464 3.481h-11.878" />
      <path d="M3 3l18 18" />
    </svg>
  )
  // warn
  return <svg {...p}><path d="M12 4l9 16H3z" /><path d="M12 10v4" /><path d="M12 17h.01" /></svg>
}

// Индикатор состояния синхронизации в шапке.
function SyncBadge() {
  const { online, syncing, pending, dead, netError } = useSyncStatus()
  // Класс/иконка/текст — чистой логикой (см. lib/syncStatus.js). Иконка есть всегда,
  // текст — только когда есть что чинить (очередь/офлайн/застряло). Застрявшие
  // изменения (dead) делают бейдж предупреждающим, а не «синхронизировано», пока
  // карточки висят с желтым кружком. netError — последний прогон синка упал по сети
  // (напр. таймаут в авиарежиме при online=true): тоже предупреждение, а не галочка.
  const { cls, icon, text, title } = syncBadgeState({ online, syncing, pending, dead, netError })
  return (
    <span className={`sync-badge ${cls}`} role="status" aria-label={title} title={title}>
      <SyncIcon name={icon} />
      {text && <span className="sync-badge-txt">{text}</span>}
    </span>
  )
}

// Статус синхронизации + колокольчик уведомлений — единый блок. Живет и в шапке
// (мобайл), и в сайдбаре (десктоп); раньше разметка колокольчика дублировалась.
export default function SyncTools({ unread, onOpenNotif }) {
  return (
    <>
      <SyncBadge />
      <button
        className={'bell' + (unread > 0 ? ' has' : '')}
        onClick={onOpenNotif}
        aria-label={unread > 0 ? `Уведомления: ${unread} новых` : 'Уведомления'}
      >
        <svg
          className="bell-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="bell-count">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>
    </>
  )
}
