// Экран «Пуш-уведомления» (Профиль → Настройки, v7.1.4). До него главный тумблер
// и типы стояли прямо в Настройках «деревом»: тумблер → аккордеон «Какие
// присылать» → вложенный список с отступом. Теперь в Настройках одна строка со
// статусом, а здесь — тумблер этого устройства и типы одной карточкой.
// Состояние — hooks/usePushToggle.js (строка Настроек узнает об изменениях
// отсюда через событие хука).
//
// Пропсы: user, onBack().
import BackButton from '../components/ui/BackButton.jsx'
import PushToggle from '../components/notifications/PushToggle.jsx'
import PushTypes from '../components/notifications/PushTypes.jsx'
import { usePushToggle } from '../hooks/usePushToggle.js'

export default function PushSettingsScreen({ user, onBack }) {
  const push = usePushToggle(user.id)
  return (
    <div className="screen push-screen">
      <div className="admin-head">
        <BackButton onClick={onBack} />
        <h2 className="admin-title">Пуш-уведомления</h2>
      </div>

      <section className="sec">
        <PushToggle
          label="Присылать на это устройство"
          availability={push.availability}
          enabled={push.enabled}
          busy={push.busy}
          error={push.error}
          onToggle={push.toggle}
        />
      </section>

      {push.availability === 'ok' && (
        <section className="sec">
          <p className="sec-title">Какие присылать</p>
          <PushTypes
            prefs={push.prefs}
            busyType={push.prefsBusy}
            error={push.prefsError}
            disabled={!push.enabled || push.busy}
            onChange={push.setType}
          />
          <p className="push-note">Настройки действуют на всех твоих устройствах с включёнными пушами.</p>
        </section>
      )}
    </div>
  )
}
