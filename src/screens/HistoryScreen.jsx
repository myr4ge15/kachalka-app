import { useState, useMemo, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getWorkouts, saveTemplate } from '../db/repo.js'
import { syncNow } from '../db/sync.js'
import { daySubTags, tagSlug, matchesGroup, availableGroups } from '../lib/dayTags.js'
import { labelOf, majorOf } from '../lib/muscles.js'
import { exerciseMetric, fmtSet } from '../lib/metric.js'
import { exportWorkouts } from '../lib/exportWorkout.js'
import { useExportSelection } from '../hooks/useExportSelection.js'
import WorkoutScreen from './WorkoutScreen.jsx'
import TemplatesScreen from './TemplatesScreen.jsx'
import CardsSkeleton from '../components/CardsSkeleton.jsx'
import ExportBar from '../components/ExportBar.jsx'
import WorkoutFinishSheet from '../components/WorkoutFinishSheet.jsx'
import WorkoutCalendar from '../components/WorkoutCalendar.jsx'
import { defaultTemplateName, templateExercisesFromWorkout } from '../lib/templateFromWorkout.js'
import { HAPTIC, vibrate } from '../lib/haptics.js'
import { onReselect } from '../lib/appEvents.js'
import { fmtCardDate } from '../lib/dates.js'


function summarize(w) {
  const entries = w.entries ?? []
  const exCount = entries.length
  const setCount = entries.reduce((n, e) => n + (e.sets?.length ?? 0), 0)
  return { exCount, setCount }
}

// Десктоп vs мобайл: на широком экране (≥900px) хаб «Мои тренировки» — master-
// detail (список слева, редактор справа), на мобиле — прежний полноэкранный свап.
// Подписка на matchMedia, чтобы раскладка менялась и при ресайзе окна.
function useMediaQuery(query) {
  const [match, setMatch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  )
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatch(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}

// Хаб «Мои тренировки»: список тренировок + вход в композер/деталь.
//   selected === null → список
//   selected === 'new' → новая тренировка
//   selected === <id>  → деталь существующей
//
// Пропсы связи с App:
//   openNew            — одноразовый интент «открой сразу новую тренировку»
//                        (плавающая «+» и кнопки Главной); гасится через
//                        onOpenNewConsumed, чтобы не переоткрывать композер.
//   onBusyChange(bool) — хаб ушел в под-вид (композер/деталь/шаблоны) или включил
//                        режим выбора для экспорта: App прячет плавающую «+».
//   openCalendar       — одноразовый интент «открой календарь» (v6.3.0): false —
//                        нет; null — на сегодня; 'YYYY-MM-DD' — сразу этот день.
//   onReturn()         — календарь открыт из Ритма Главной: закрытие календаря или
//                        «назад» из открытой в нем тренировки возвращают в Ритм (v6.3.5).
export default function HistoryScreen({
  user,
  openNew = false,
  onOpenNewConsumed,
  openCalendar = false,
  onOpenCalendarConsumed,
  onReturn,
  onBusyChange,
  onOpenProgress,
}) {
  const workouts = useLiveQuery(() => getWorkouts(user.id), [user.id])
  const loading = workouts === undefined
  // useMemo, а не голое `workouts ?? []`: при загрузке (workouts===undefined) `?? []`
  // давал бы НОВЫЙ [] на каждый рендер → deps производных useMemo (groups/shown)
  // менялись бы каждый раз и мемоизация не работала. Мемо-обертка держит ссылку
  // стабильной (пустой массив един, пока workouts не приедет).
  const list = useMemo(() => workouts ?? [], [workouts])

  const isDesktop = useMediaQuery('(min-width: 900px)')

  const [selected, setSelected] = useState(null)
  const [finishResult, setFinishResult] = useState(null)
  const [finishTemplate, setFinishTemplate] = useState({ status: 'idle', message: null })
  // Фильтр по группе мышц (null = «Все»). Чипы строим только из реально
  // встречающихся групп, чтобы не показывать пустые.
  const [filter, setFilter] = useState(null)
  // Календарь (v6.3.0): false — закрыт, иначе { date } — с какого дня открыть.
  const [calendar, setCalendar] = useState(false)
  // Пришли из Ритма (интент календаря) — выход из этой «вылазки» ведет обратно на Главную.
  const [fromRhythm, setFromRhythm] = useState(false)
  const groups = useMemo(() => availableGroups(list), [list])
  const shown = useMemo(
    () => list.filter((w) => matchesGroup(w.entries, filter)),
    [list, filter]
  )

  // Режим экспорта: мультивыбор тренировок из списка → выгрузка в JSON. Общий хук
  // с «Шаблонами» (useExportSelection). «Все» берет отфильтрованный shown, выгрузка
  // — из полного list.
  const { selectMode, picked, toggleSelectMode, togglePick, pickAll, exportPicked } =
    useExportSelection(exportWorkouts)

  // Интент «открой календарь» из App (ссылка Ритма на Главной): считываем и гасим.
  useEffect(() => {
    if (openCalendar === false) return
    setSelected(null)
    setCalendar({ date: openCalendar })
    setFromRhythm(Boolean(onReturn))
    onOpenCalendarConsumed?.()
  }, [openCalendar, onOpenCalendarConsumed, onReturn])

  // Закрыть календарь / тренировку: из Ритма — назад в Ритм, иначе — к списку.
  function backFromRhythmOr(fallback) {
    if (fromRhythm) {
      setFromRhythm(false)
      onReturn?.()
      return
    }
    fallback()
  }
  function closeSelected() {
    backFromRhythmOr(() => setSelected(null))
  }

  // Интент «сразу новая тренировка» из App (плавающая «+» / кнопки Главной).
  // Считываем и тут же гасим у родителя: иначе повторный рендер снова уводил бы
  // в композер после возврата к списку.
  useEffect(() => {
    if (!openNew) return
    setSelected('new')
    setFromRhythm(false)
    onOpenNewConsumed?.()
  }, [openNew, onOpenNewConsumed])

  // Тап по УЖЕ активной вкладке «Тренировки» = выход из под-вида к списку.
  // Раньше он не делал ничего: человек, зашедший в композер с Главной, жал
  // «Тренировки» (ожидая попасть в список — там шаблоны и история) и оставался
  // на том же экране; единственным выходом была «Назад», которая по интуиции
  // должна была вернуть на Главную. Теперь вкладка ведет туда, куда написано.
  // Данные при этом не теряются: черновик НОВОЙ тренировки живет в хранилище
  // черновика (lib/draftStore.js) и восстановится при повторном входе, а выход из правки
  // существующей ведет себя ровно как кнопка «← Назад» рядом.
  useEffect(() => onReselect((t) => {
    if (t !== 'history') return
    setSelected(null)
    setFromRhythm(false)
    setFinishResult(null)
  }), [])

  // Сообщаем App, занят ли хаб собственным под-видом (тогда плавающая «+» прячется:
  // в композере она не нужна, а над баром экспорта/«Сохранить» — просто мешает).
  // На размонтировании гасим флаг, чтобы кнопка вернулась на других вкладках.
  useEffect(() => {
    onBusyChange?.(selected !== null || selectMode || finishResult !== null)
    return () => onBusyChange?.(false)
  }, [selected, selectMode, finishResult, onBusyChange])

  function handleSaved(result) {
    setSelected(null)
    setFromRhythm(false)
    setFinishResult(result)
    setFinishTemplate({ status: 'idle', message: null })
  }

  function openFinishProgress(exerciseId) {
    setFinishResult(null)
    onOpenProgress?.(exerciseId)
  }

  async function createFinishTemplate() {
    const workout = finishResult?.workout
    if (!workout || finishTemplate.status === 'busy' || finishTemplate.status === 'done') return
    const name = defaultTemplateName(workout.performed_at)
    setFinishTemplate({ status: 'busy', message: null })
    try {
      const exercises = templateExercisesFromWorkout(workout.entries)
      if (!exercises.length) throw new Error('В тренировке нет упражнений с подходами.')
      await saveTemplate({
        user_id: user.id,
        name,
        exercises,
        is_public: false,
      })
      if (navigator.onLine) syncNow(user.id)
      vibrate(HAPTIC.success)
      setFinishTemplate({ status: 'done', message: `Шаблон «${name}» создан` })
    } catch (error) {
      setFinishTemplate({
        status: 'error',
        message: 'Не удалось создать шаблон: ' + (error?.message ?? error),
      })
    }
  }

  // Вход в редактор/деталь и возврат к списку должны начинаться с верха страницы.
  // Скроллится не окно, а внешняя .content (overflow-y:auto, см. App.jsx/index.css);
  // при смене под-вида внутри хаба ее позиция не сбрасывалась — после «Сохранить»
  // (кнопка внизу редактора) пользователь возвращался к списку, прокрученному вниз.
  // На десктопе (master-detail) список остается на месте — прыжок к верху не нужен.
  useEffect(() => {
    if (!isDesktop) document.querySelector('.content')?.scrollTo({ top: 0 })
  }, [selected, isDesktop])

  // Список тренировок + управление (кнопки, фильтр, экспорт). Переиспользуется
  // и на мобиле (одна колонка), и на десктопе (левая колонка master-detail).
  // Заголовок хаба + иконка календаря справа (как «поиск по дате» в мессенджерах).
  function renderHead() {
    return (
      <div className="screen-head">
        <h2 className="screen-title">Мои тренировки</h2>
        {list.length > 0 && (
          <button className="back-btn" aria-label="Календарь тренировок" onClick={() => setCalendar({ date: null })}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {/* Тот же значок, что у даты в карточке тренировки (DateField). */}
              <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
          </button>
        )}
      </div>
    )
  }

  function renderCalendar() {
    if (!calendar) return null
    return (
      <WorkoutCalendar
        workouts={shown}
        filter={filter}
        initialDate={calendar.date}
        onDismiss={() => {
          setCalendar(false)
          backFromRhythmOr(() => {})
        }}
        onOpen={(id) => {
          setCalendar(false)
          setSelected(id)
        }}
      />
    )
  }

  function renderList() {
    return (
      <>
        {/* Новая тренировка: на мобиле — «+» по центру меню, на десктопе (v6.2.3) —
            «+ Новая тренировка» в боковой колонке (App.jsx). Своя кнопка хаба убрана,
            чтобы не дублировать. */}

        <button className="tpl-link" onClick={() => setSelected('templates')}>
          <svg className="tpl-link-ico" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4V3h6v1M9 10h6M9 14h6" />
          </svg>
          <span className="tpl-link-txt">Шаблоны</span>
          <svg className="tpl-link-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </button>

        {loading && <CardsSkeleton cards={4} />}

        {/* Пустой список — единственный экран, где призыв к действию обязан быть
            ЯВНЫМ: на мобиле вход в композер дает только плавающая «+», и новичок
            ее не связывает с «записать тренировку». Кнопка ведет туда же, что и
            FAB, и на десктопе дублирует «+ Добавить тренировку» сверху — но там
            список пуст, лишней она не выглядит. */}
        {!loading && list.length === 0 && (
          <div className="empty-cta">
            <p className="muted empty">Пока нет записанных тренировок.</p>
            <button className="btn primary full" onClick={() => setSelected('new')}>
              + Записать тренировку
            </button>
          </div>
        )}

        {groups.length > 0 && (
          <div className="chips tag-filter">
            <button
              className={filter === null ? 'chip active' : 'chip'}
              onClick={() => setFilter(null)}
            >
              все
            </button>
            {groups.map((g) => (
              <button
                key={g}
                className={filter === g ? 'chip active' : 'chip'}
                onClick={() => setFilter(filter === g ? null : g)}
              >
                {g}
              </button>
            ))}
          </div>
        )}

        {!loading && list.length > 0 && shown.length === 0 && (
          <p className="muted empty">Нет тренировок с группой «{filter}».</p>
        )}

        {shown.map((w) => {
          const { exCount, setCount } = summarize(w)
          const tags = daySubTags(w.entries)
          const unsynced = Boolean(w._dirty)
          const isOpen = !selectMode && selected === w.id
          return (
            <button
              key={w.id}
              className={
                'card history-card history-tap'
                + (selectMode && picked.has(w.id) ? ' picked' : '')
                + (isOpen ? ' open' : '')
              }
              onClick={() => (selectMode ? togglePick(w.id) : setSelected(w.id))}
            >
              <div className="history-head">
                <div>
                  <div className="history-date">
                    {fmtCardDate(w.performed_at)}
                    {unsynced && <span className="dot-unsynced" title="Ждет синхронизации">●</span>}
                  </div>
                  <div className="muted history-sub">
                    {exCount} упр. · {setCount} подх.
                  </div>
                </div>
                {selectMode ? (
                  <span className={'history-check' + (picked.has(w.id) ? ' on' : '')} aria-hidden="true">
                    {picked.has(w.id) ? '✓' : ''}
                  </span>
                ) : (
                  <svg className="history-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none"
                    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                )}
              </div>

              {tags.length > 0 && (
                <div className="day-tags">
                  {tags.map((s) => (
                    <span key={s} className={`day-tag tag-${tagSlug(majorOf(s))}`}>{labelOf(s)}</span>
                  ))}
                </div>
              )}

              <ul className="history-list">
                {(w.entries ?? []).map((e, i) => (
                  <li key={e.exercise_id ?? e.exercise?.id ?? i} className="history-ex">
                    <span className="history-ex-name">{e.exercise?.name ?? '—'}</span>
                    <span className="history-ex-sets">
                      {(e.sets ?? []).map((s) => fmtSet(exerciseMetric(e.exercise), s)).join(', ') || '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </button>
          )
        })}

        {/* Экспорт уведен из верхнего слота под список, чтобы верх занимали фильтры.
            Вне режима выбора — приглушенная ссылка внизу; в режиме выбора — фиксир.
            бар над таббаром (общий ExportBar). «Все» — по отфильтрованному shown. */}
        <ExportBar
          selectMode={selectMode}
          count={picked.size}
          label="Экспорт тренировок"
          canShow={!loading && list.length > 0}
          onToggleMode={toggleSelectMode}
          onPickAll={() => pickAll(shown)}
          onExport={() => exportPicked(list)}
        />
      </>
    )
  }

  // Шаблоны — отдельный полноэкранный поток (и на мобиле, и на десктопе).
  if (selected === 'templates') {
    return <TemplatesScreen user={user} onBack={() => setSelected(null)} />
  }

  // Мобайл: прежнее поведение — деталь/композер открывается вместо списка.
  if (!isDesktop) {
    if (selected !== null) {
      return (
        <WorkoutScreen
          key={selected}
          user={user}
          workoutId={selected === 'new' ? null : selected}
          onBack={closeSelected}
          onSaved={handleSaved}
        />
      )
    }
    return (
      <>
        <div className="screen">
          {renderHead()}
          {renderList()}
        </div>
        {renderCalendar()}
        {finishResult && (
          <WorkoutFinishSheet
            workout={finishResult.workout}
            events={finishResult.events}
            onDone={() => setFinishResult(null)}
            onOpenProgress={openFinishProgress}
            onCreateTemplate={createFinishTemplate}
            templateStatus={finishTemplate.status}
            templateMessage={finishTemplate.message}
          />
        )}
      </>
    )
  }

  // Десктоп: master-detail — список слева (липкий), редактор/деталь справа.
  return (
    <div className="md-screen">
      <div className="md-layout">
        <div className="md-list-col">
          {renderHead()}
          {renderList()}
          {renderCalendar()}
        </div>
        <div className="md-detail-col">
          {selected === null ? (
            <div className="md-empty">
              <span className="md-empty-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round"><path d="M1.5 12h21" /><rect x="3" y="8.5" width="2.6" height="7" rx="1" fill="currentColor" stroke="none" /><rect x="6.4" y="6" width="3" height="12" rx="1.2" fill="currentColor" stroke="none" /><rect x="14.6" y="6" width="3" height="12" rx="1.2" fill="currentColor" stroke="none" /><rect x="18.4" y="8.5" width="2.6" height="7" rx="1" fill="currentColor" stroke="none" /></svg>
              </span>
              <p>Выбери тренировку в списке, чтобы посмотреть и отредактировать ее,
                 или начни новую кнопкой «+ Новая тренировка» слева.</p>
            </div>
          ) : (
            <WorkoutScreen
              key={selected}
              user={user}
              workoutId={selected === 'new' ? null : selected}
              onBack={closeSelected}
              onSaved={handleSaved}
            />
          )}
        </div>
      </div>
      {finishResult && (
        <WorkoutFinishSheet
          workout={finishResult.workout}
          events={finishResult.events}
          onDone={() => setFinishResult(null)}
          onOpenProgress={openFinishProgress}
          onCreateTemplate={createFinishTemplate}
          templateStatus={finishTemplate.status}
          templateMessage={finishTemplate.message}
        />
      )}
    </div>
  )
}
