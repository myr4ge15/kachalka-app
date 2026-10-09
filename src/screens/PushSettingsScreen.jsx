// Экран «Пуш-уведомления» (Профиль → Настройки, v7.1.4). До него главный тумблер
// и типы стояли прямо в Настройках «деревом»: тумблер → аккордеон «Какие
// присылать» → вложенный список с отступом. Теперь в Настройках одна строка со
// статусом, а здесь — тумблер этого устройства и типы одной карточкой.
// Состояние — hooks/usePushToggle.js (строка Настроек узнает об изменениях
// отсюда через событие хука).
//
// Пропсы: user, onBack().
import BackButton from '../components/BackButton.jsx'
import PushToggle from '../components/PushToggle.jsx'
import PushTypes from '../components/PushTypes.jsx'
import { usePushToggle } from '../hooks/usePushToggle.js'

export default function PushSettingsScreen({ user, onBack }) {
  const push = usePushToggle(user.id)
  const canPick = push.availability === 'ok' && push.enabled
  return (
    <div className="screen push-screen">
      <div className="admin-head">
        <BackButton onClick={onBack} />
        <h2 className="admin-title">Пуш-уведомления</h2>
      </div>

      <section className="sec">
        <PushToggle
          label="🔔 Присылать на это устройство"
          availability={push.availability}
          enabled={push.enabled}
          busy={push.busy}
          error={push.error}
          onToggle={push.toggle}
        />
      </section>

      {canPick ? (
        <section className="sec">
          <p className="sec-title">Какие присылать</p>
          <PushTypes
            prefs={push.prefs}
            busyType={push.prefsBusy}
            error={push.prefsError}
            onChange={push.setType}
          />
          <p className="push-note">Выбор общий для всех твоих устройств.</p>
        </section>
      ) : push.availability === 'ok' && (
        <p className="push-note">Включи — и здесь можно будет выбрать, о чем присылать.</p>
      )}
    </div>
  )
}
