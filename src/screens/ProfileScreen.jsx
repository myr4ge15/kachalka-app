import { plural } from '../lib/plural.js'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getWorkouts, getCachedUser, setCachedSex, getProgSettings, setProgEnabled, getPrivacyFlag } from '../db/repo.js'
import { readGoals } from '../db/notifications.js'
import { getCachedLeaderboard } from '../db/leaderboard.js'
import { summarize } from '../lib/profileStats.js'
import { currentValues, evaluateBadges, BADGES } from '../lib/badges.js'
import { setSex, LoginError } from '../lib/auth.js'
import LogoutButton from '../components/LogoutButton.jsx'
import MemberInvites from '../components/MemberInvites.jsx'
import SexPicker from '../components/SexPicker.jsx'
import PushToggle from '../components/PushToggle.jsx'
import PushTypes from '../components/PushTypes.jsx'
import { usePushToggle } from '../hooks/usePushToggle.js'
import { myUnreadReplies } from '../lib/feedbackApi.js'
import CardsSkeleton from '../components/CardsSkeleton.jsx'
import StatGrid from '../components/StatGrid.jsx'
import PersonalRecords from '../components/PersonalRecords.jsx'
import BackButton from '../components/BackButton.jsx'
import { useEdgeSwipeBack } from '../hooks/useEdgeSwipeBack.js'
import { WHATS_NEW } from '../content/whatsNew.js'
import { hasUnopened, readMark, fmtWhatsNewDate, OPENED_KEY } from '../lib/whatsNew.js'
import { useAliveRef } from '../hooks/useAliveRef.js'
import ProfileHeader from '../components/profile/ProfileHeader.jsx'
import GoalsSection from '../components/profile/GoalsSection.jsx'
import DeadLetterAlert from '../components/profile/DeadLetterAlert.jsx'
import PinChangeForm from '../components/profile/PinChangeForm.jsx'
import LoginChangeForm from '../components/profile/LoginChangeForm.jsx'
import BackupActions from '../components/profile/BackupActions.jsx'
import DeleteMyData from '../components/profile/DeleteMyData.jsx'
import AppVersionLink from '../components/profile/AppVersionLink.jsx'
import { settleScroll } from '../lib/scrollBox.js'

// Экран «Профиль» (ЛК). Все про самого пользователя; пер-упражненческую
// аналитику не дублируем — рекорды уводят в «Прогресс». Считаем на клиенте из
// уже имеющихся денормализованных тренировок. Цель (фаза 2b) дополнительно
// уходит на сервер при сохранении, чтобы достижение увидел Telegram-бот.
//
// Блоки со своим состоянием (шапка, цели, PIN, бэкап, удаление, dead-letter) —
// components/profile/* (v6.14.1); здесь — сводка, навигация и слой Настроек.
//
// Пропсы: user, onLogout, onOpenProgress(exerciseId), onOpenFeed().
export default function ProfileScreen({ user, onLogout, onOpenProgress, onOpenFeed, onRenamed, onOpenAdmin, onOpenMyExercises, onOpenAchievements, onOpenAppearance, onOpenWhatsNew, onOpenFeedback, startInSettings = false, onStartInSettingsConsumed, contentRef, edgeSwipeOn = false }) {
  const workouts = useLiveQuery(() => getWorkouts(user.id), [user.id])
  const goals = useLiveQuery(() => readGoals(user.id), [user.id])
  const myCached = useLiveQuery(() => getCachedUser(user.id), [user.id])
  // Тумблер автопрогрессии (рекомендации весов/повторов в тренировке).
  const progEnabled = useLiveQuery(() => getProgSettings(user.id).then((p) => p.enabled), [user.id], true)
  // Пуш-уведомления этого браузера (v6.6.0): состояние, переключение, ошибка.
  const push = usePushToggle(user.id)
  const loading = workouts === undefined

  const aliveRef = useAliveRef()

  const summary = useMemo(() => summarize(workouts ?? []), [workouts])
  const records = summary.personalRecords
  // Тизер достижений: сколько вех закрыто сейчас (из тех же тренировок; точные
  // даты/необратимость — уже на экране «Достижения»).
  const badgesEarned = useMemo(
    () => evaluateBadges(currentValues(workouts ?? []), {}).earned.length,
    [workouts]
  )

  // Место в лидерборде в СВОЕМ борде (мужской — жим, женский — ягодичный мостик).
  // Кэш Ленты/снимок, только чтение. { n, board } | null (до загрузки — null).
  // useLiveQuery над Dexie-кэшем: место само пересчитывается, когда pull освежает
  // снимок лидерборда, а не только на маунте экрана (прежний one-shot effect).
  // Приватный в рейтинге не участвует — место не показываем.
  const place = useLiveQuery(async () => {
    try {
      if (await getPrivacyFlag(user.id)) return null
      const board = await getCachedLeaderboard()
      const inF = (board.female ?? []).findIndex((r) => r.user_id === user.id)
      if (inF >= 0) return { n: inF + 1, board: 'f' }
      const inM = (board.male ?? []).findIndex((r) => r.user_id === user.id)
      if (inM >= 0) return { n: inM + 1, board: 'm' }
      return null
    } catch { return null }
  }, [user.id], null)

  // «Настройки» — отдельный под-экран Профиля (v6.3.3): список сразу сверху, со
  // стрелкой «назад». Состояние (PIN-форма, пол, бэкап) живет здесь же, поэтому это
  // вид внутри ProfileScreen, а не отдельный роут App.
  // startInSettings — возврат из под-экрана Настроек (Оформление/Каталог/Обновления): сразу
  // показываем список Настроек, а не корень Профиля (v6.3.5), и гасим интент у App.
  const [settingsOpen, setSettingsOpen] = useState(startInSettings)
  const wnUnopened = hasUnopened(WHATS_NEW, readMark(OPENED_KEY))
  // Непрочитанный ответ разработчика на обращение (v6.11.0) — метка «ответ» у пункта
  // «Написать разработчику». С v6.12.0 пункт в корне Профиля (а не в Настройках) —
  // тянем при входе в Профиль; любая ошибка — просто без метки.
  const [fbUnread, setFbUnread] = useState(0)
  useEffect(() => {
    let live = true
    myUnreadReplies(user.id).then((n) => { if (live) setFbUnread(n) })
    return () => { live = false }
  }, [user.id])
  useEffect(() => {
    if (startInSettings) onStartInSettingsConsumed?.()
  }, [startInSettings, onStartInSettingsConsumed])

  // Свой пол (v6.2.0): оптимистично показываем выбор, откатываем при ошибке.
  const [sexPending, setSexPending] = useState(undefined) // undefined — нет правки
  const [sexErr, setSexErr] = useState('')
  const sexValue = sexPending !== undefined ? sexPending : (myCached?.sex ?? null)
  async function changeSex(next) {
    setSexErr('')
    setSexPending(next)
    try {
      const saved = await setSex(user.id, next)
      await setCachedSex(user.id, saved)
    } catch (e) {
      if (aliveRef.current) setSexErr(e instanceof LoginError ? e.message : 'Не удалось сохранить.')
    } finally {
      if (aliveRef.current) setSexPending(undefined)
    }
  }

  const settingsSurfaceRef = useRef(null)
  const profileSurfaceRef = useRef(null)
  useLayoutEffect(() => {
    const box = contentRef?.current
    if (!box) return undefined
    const top = settingsOpen ? 0 : Number(profileSurfaceRef.current?.dataset.scrollTop || 0)
    // v6.12.0 → v6.15.0: на iPhone позицию после commit перебивала инерция WebKit —
    // Настройки открывались внизу или пустыми до тапа. settleScroll гасит инерцию
    // и повторяет установку в следующем кадре (lib/scrollBox.js).
    return settleScroll(box, top)
  }, [settingsOpen, contentRef])

  function openSettings() {
    if (profileSurfaceRef.current) profileSurfaceRef.current.dataset.scrollTop = String(contentRef?.current?.scrollTop || 0)
    setSettingsOpen(true) // позицию ставит layout-эффект выше, уже после commit
  }
  function closeSettings() {
    setSettingsOpen(false) // PIN-форма и подтверждение удаления размонтируются вместе с Настройками
  }

  useEdgeSwipeBack(contentRef, settingsSurfaceRef, closeSettings, edgeSwipeOn && settingsOpen)

  const settingsView = (
      <div className="screen profile settings-screen">
        <div className="detail-head">
          <BackButton onClick={closeSettings} />
          <h2 className="screen-title detail-title">Настройки</h2>
        </div>
        {/* Проблема с отправкой — важный алерт: виден всегда, даже когда свернуто. */}
        <DeadLetterAlert userId={user.id} />

          <div className="actions">
            {/* «Что нового» (v6.4.0) — история обновлений; «новое», пока свежая запись не открыта. */}
            <button className={'act' + (wnUnopened ? ' act-new' : '')} onClick={() => onOpenWhatsNew?.()}>
              <span className="act-txt">
                🆕 Что нового
                <span className="act-sub">v{WHATS_NEW[0]?.version} · {fmtWhatsNewDate(WHATS_NEW[0]?.date)}</span>
              </span>
              {wnUnopened && <span className="act-badge">новое</span>}
            </button>
            <button className="act" onClick={() => onOpenAppearance?.()}>
              <span className="act-txt">
                🎨 Оформление
                <span className="act-sub">акцентный цвет приложения</span>
              </span>
            </button>
            <SexPicker value={sexValue} busy={sexPending !== undefined} error={sexErr} onChange={changeSex} />
            <button
              className="act toggle-act"
              role="switch"
              aria-checked={progEnabled}
              onClick={() => setProgEnabled(user.id, !progEnabled)}
            >
              <span className="toggle-act-txt">
                📈 Рекомендации прогрессии
                <span className="toggle-act-sub">подсказка веса/повторений при добавлении упражнения</span>
              </span>
              <span className={'toggle-pill' + (progEnabled ? ' on' : '')} aria-hidden="true">
                <span className="toggle-knob" />
              </span>
            </button>
            <PushToggle
              availability={push.availability}
              enabled={push.enabled}
              busy={push.busy}
              error={push.error}
              onToggle={push.toggle}
            />
            {push.availability === 'ok' && push.enabled && (
              <PushTypes
                prefs={push.prefs}
                busyType={push.prefsBusy}
                error={push.prefsError}
                onChange={push.setType}
              />
            )}
            <LoginChangeForm userId={user.id} />
            <PinChangeForm userId={user.id} />
            {user.role !== 'admin' && (
              <button className="act" onClick={() => onOpenMyExercises?.()}>🏋 Каталог упражнений</button>
            )}
            <BackupActions userId={user.id} />
            <DeleteMyData userId={user.id} />
          </div>
        <AppVersionLink />
      </div>
  )

  return (
    <div className="nav-stack profile-stack">
    <div ref={profileSurfaceRef} className={settingsOpen ? "nav-layer nav-underlay" : "nav-layer nav-current"} inert={settingsOpen} aria-hidden={settingsOpen ? true : undefined}>
    <div className="screen profile">
      {/* шапка профиля */}
      <ProfileHeader user={user} avatarUrl={myCached?.avatar_url} onRenamed={onRenamed} />

      {loading && <CardsSkeleton cards={3} />}

      {!loading && summary.totalWorkouts === 0 && (
        <p className="muted empty">
          Здесь будет твоя сводка: рекорды и цель. Запиши первую тренировку 💪
        </p>
      )}

      {!loading && summary.totalWorkouts > 0 && (
        <>
          {/* быстрые цифры — «за все время». Скользящие метрики (за месяц,
              серия) живут на Главной, здесь не дублируем (акценты разведены). */}
          <StatGrid totalWorkouts={summary.totalWorkouts} tonnage={summary.tonnage} />

          {/* вход на экран достижений/бейджей */}
          <section className="sec">
            <button className="leader-link" onClick={() => onOpenAchievements?.()}>
              <div>
                <div className="v">🏆 Достижения</div>
                <div className="k">получено {badgesEarned} из {BADGES.length} бейджей</div>
              </div>
              <span className="go">Открыть ›</span>
            </button>
          </section>

          {/* личные цели (мульти-цели) */}
          <GoalsSection userId={user.id} goals={goals} records={records} workouts={workouts} />

          {/* личные рекорды → Прогресс */}
          <PersonalRecords records={records} onOpenProgress={onOpenProgress} />

          {/* любимое упражнение */}
          {summary.favExercise && (
            <section className="sec">
              <p className="sec-title">Любимое</p>
              <div className="info-row">
                <span className="em" aria-hidden="true">🔁</span>
                <div>
                  <div className="v">{summary.favExercise.name}</div>
                  <div className="k">чаще всего · {summary.favExercise.sets} {plural(summary.favExercise.sets, 'подход', 'подхода', 'подходов')}</div>
                </div>
              </div>
            </section>
          )}

          {/* мостик к лидерборду */}
          {place != null && (
            <section className="sec">
              <p className="sec-title">А на фоне друзей</p>
              <button className="leader-link" onClick={() => onOpenFeed?.()}>
                <div>
                  <div className="v">{place.n}-е место {place.board === 'f' ? 'по ягодичному мостику' : 'по жиму'}</div>
                  <div className="k">лидерборд живет в Ленте</div>
                </div>
                <span className="go">Лента ›</span>
              </button>
            </section>
          )}
        </>
      )}

      {/* Настройки — отдельный экран (v6.3.3): раньше это был свернутый блок в самом
          низу, и после «раскрыть» список оставался за краем — на экране висело
          «Любимое». Выход — на виду в Профиле, как раньше. */}
      <section className="sec settings-sec">
        {/* Проблема с отправкой — важный алерт: виден всегда, даже когда свернуто. */}
        <DeadLetterAlert userId={user.id} />

        <MemberInvites key={user.id} userId={user.id} />
        {/* «Написать разработчику» (v6.11.0; в корне Профиля с v6.12.0 — в Настройках
            его не находили): ошибка, идея, вопрос — сразу разработчику. */}
        <button className={'settings-toggle fb-entry' + (fbUnread ? ' act-new' : '')} onClick={() => onOpenFeedback?.()}>
          <span className="settings-title"><span aria-hidden="true">💬</span> Написать разработчику</span>
          {fbUnread > 0 ? <span className="act-badge">ответ</span> : <span className="settings-chev" aria-hidden="true">›</span>}
        </button>
        {user.role === 'admin' && (
          <button className="settings-toggle" onClick={() => onOpenAdmin?.()}>
            <span className="settings-title"><span aria-hidden="true">🛠</span> Админка</span>
            <span className="settings-chev" aria-hidden="true">›</span>
          </button>
        )}
        <button className="settings-toggle" onClick={openSettings}>
          <span className="settings-title"><span aria-hidden="true">⚙️</span> Настройки</span>
          <span className="settings-chev" aria-hidden="true">›</span>
        </button>
        <div className="actions">
          {/* Занятость и защита от двойного тапа — в LogoutButton (РЕВЬЮ-КОДА-2026-10-02). */}
          <LogoutButton onLogout={onLogout} />
        </div>
      </section>

      <AppVersionLink />
    </div>
    </div>
    {settingsOpen && <div className="nav-layer nav-current" ref={settingsSurfaceRef}>{settingsView}</div>}
    </div>
  )
}
