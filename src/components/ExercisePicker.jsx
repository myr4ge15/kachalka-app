import { useState, useMemo, useDeferredValue } from 'react'
import { findSimilar, findExactDuplicate } from '../lib/similar.js'
import { searchExercises } from '../lib/exerciseSearch.js'
import { submusclesOf, secondaryOptionsFor, labelOf, majorOf, defaultSubmuscleFor } from '../lib/muscles.js'
import SheetDialog from './SheetDialog.jsx'

// Канонические группы мышц из ТЗ (Приложение A / п. 3.2). К ним добавляем
// все группы, реально встретившиеся в справочнике, чтобы ничего не потерять.
const BASE_GROUPS = ['грудь', 'спина', 'ноги', 'плечи', 'бицепс', 'трицепс', 'пресс', 'кардио']

// Подбор упражнения из справочника: поиск по названию + фильтр по группе.
// Если нужного упражнения нет — «+ добавить своё» (ТЗ 3.2 / 4.4): задаём
// название и группу, упражнение сохраняется в общий справочник (onCreate) и
// сразу добавляется в тренировку.
export default function ExercisePicker({
  exercises,
  usage = { recent: [], frequent: [] },
  onPick,
  onClose,
  onCreate,
  title = 'Упражнение',
}) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('все')

  // Режим создания своего упражнения.
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [newSub, setNewSub] = useState('')          // основная подмышца (primary)
  const [newSecondary, setNewSecondary] = useState([]) // вторичные мышцы (слаги)
  const [newMetric, setNewMetric] = useState('weight') // weight | reps | time
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const groups = useMemo(() => {
    const set = new Set(exercises.map((e) => e.muscle_group).filter(Boolean))
    return ['все', ...Array.from(set)]
  }, [exercises])

  // Группы, предлагаемые в форме создания: канон из ТЗ + всё, что есть в базе.
  const createGroups = useMemo(() => {
    const set = new Set(BASE_GROUPS)
    for (const e of exercises) if (e.muscle_group) set.add(e.muscle_group)
    return Array.from(set)
  }, [exercises])

  // Поиск и поиск похожих не блокируют ввод: фильтрация идёт по «отложенному»
  // значению (useDeferredValue), пока поле остаётся отзывчивым на каждую букву —
  // фактический debounce без таймеров. Заметно на мобильном и большом справочнике.
  const deferredQuery = useDeferredValue(query)
  const deferredNewName = useDeferredValue(newName)

  // Фильтр по группе — сначала (он сужает справочник), умный поиск — по остатку.
  // `byName` — совпадения по названию, `byMuscle` — только по мышце («плеч»).
  const { byName: filtered, byMuscle } = useMemo(() => {
    const inGroup =
      group === 'все' ? exercises : exercises.filter((e) => e.muscle_group === group)
    return searchExercises(deferredQuery, inGroup)
  }, [exercises, deferredQuery, group])

  // Введённого названия нет в справочнике (точного совпадения) → предлагаем
  // создать его прямо из поля. Анти-дубли подтянутся в форме создания (similar).
  const qTrim = deferredQuery.trim()
  // Сверка нормализованная (ё/е, пробелы, пунктуация): иначе «жим лежа» звало
  // создать дубль уже существующего «Жим лёжа».
  const hasExact = useMemo(
    () => !!qTrim && !!findExactDuplicate(qTrim, exercises),
    [exercises, qTrim]
  )
  // Запрос, попавший ТОЛЬКО в мышцы («плеч»), — это просмотр группы, а не заявка
  // на новое упражнение: предлагать создать «плеч» бессмысленно. Общая кнопка
  // «+ добавить своё упражнение» внизу при этом остаётся доступной.
  const browsingByMuscle = filtered.length === 0 && byMuscle.length > 0
  const suggestCreate = !!onCreate && !!qTrim && !hasExact && !browsingByMuscle

  const shortcuts = useMemo(() => {
    const byId = new Map(exercises.map((e) => [e.id, e]))
    const resolve = (ids) => (ids ?? []).map((id) => byId.get(id)).filter(Boolean)
    return { recent: resolve(usage.recent), frequent: resolve(usage.frequent) }
  }, [exercises, usage])
  const showShortcuts = !qTrim && group === 'все'
  const shortcutIds = useMemo(
    () => new Set([...shortcuts.recent, ...shortcuts.frequent].map((e) => e.id)),
    [shortcuts]
  )
  const mainList = showShortcuts ? filtered.filter((e) => !shortcutIds.has(e.id)) : filtered

  // Похожие по названию — чтобы не плодить дубли (ТЗ 3.2 / 4.4). Нечёткое
  // сопоставление (нормализация ё/е, пробелы, порядок слов, опечатки), а не
  // голый includes(), который дубли вроде «жим лёжа»/«жим лежа» пропускает.
  const similar = useMemo(
    () => findSimilar(deferredNewName, exercises, { threshold: 0.45, limit: 5 }),
    [exercises, deferredNewName]
  )

  // Смена группы в форме создания: подмышку сбрасываем на дефолт группы,
  // вторичные чистим (их варианты зависят от primary).
  function pickNewGroup(g) {
    setNewGroup(g)
    setNewSub(defaultSubmuscleFor(g) ?? '')
    setNewSecondary([])
  }

  function openCreate() {
    setNewName(query.trim())
    const g = group !== 'все' ? group : ''
    setNewGroup(g)
    setNewSub(defaultSubmuscleFor(g) ?? '')
    setNewSecondary([])
    setNewMetric('weight')
    setError(null)
    setCreating(true)
  }

  async function submitCreate() {
    const name = newName.trim()
    if (!name) {
      setError('Введи название упражнения.')
      return
    }
    if (!newGroup) {
      setError('Выбери группу мышц.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const ex = await onCreate({ name, muscle_group: newGroup, metric: newMetric, submuscle: newSub, secondary: newSecondary })
      onPick(ex) // добавляем в тренировку; родитель закроет пикер
    } catch (err) {
      setError('Не удалось сохранить: ' + (err?.message ?? err))
      setBusy(false)
    }
  }

  // -------------------------- форма создания --------------------------------
  // Пикер рендерим порталом в <body>: оверлей position:fixed гарантированно
  // относительно вьюпорта (а не застревает внутри прокручиваемой .content под
  // шапкой/таббаром). Это и есть фикс «модалка не на весь экран».
  if (creating) {
    return (
      // В режиме создания клик по фону = «назад» к списку (setCreating(false)),
      // а НЕ onClose: иначе промах мимо листа стирал заполненную форму, а во время
      // сохранения ещё и размонтировал пикер на лету. Во время busy фон не реагирует.
      <SheetDialog
        title="Своё упражнение"
        actionLabel="назад"
        dismissDisabled={busy}
        onDismiss={() => setCreating(false)}
      >
          {/* Форма длиннее экрана (тип + группа + под/вторичные мышцы) — держим её
              в прокручиваемом контейнере, иначе на телефоне низ формы (и кнопка
              «Сохранить») недостижим: сам .sheet зафиксирован по высоте экрана. */}
          <div className="sheet-scroll">
          <input
            className="search"
            data-autofocus
            placeholder="Название упражнения"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />

          {similar.length > 0 && (
            <div className="create-similar">
              <span className="muted">Возможно, уже есть — нажми, чтобы выбрать:</span>
              {similar.map((e) => (
                <button key={e.id} className="similar-item" onClick={() => onPick(e)}>
                  <span>{e.name}</span>
                  <span className="picker-group">{e.muscle_group}</span>
                </button>
              ))}
            </div>
          )}

          <div className="create-label">Тип</div>
          <div className="chips">
            <button
              className={newMetric === 'weight' ? 'chip active' : 'chip'}
              onClick={() => setNewMetric('weight')}
            >
              Вес и повторы
            </button>
            <button
              className={newMetric === 'reps' ? 'chip active' : 'chip'}
              onClick={() => setNewMetric('reps')}
            >
              Только повторы
            </button>
            <button
              className={newMetric === 'time' ? 'chip active' : 'chip'}
              onClick={() => setNewMetric('time')}
            >
              На время
            </button>
          </div>

          <div className="create-label">Группа мышц</div>
          <div className="chips">
            {createGroups.map((g) => (
              <button
                key={g}
                className={g === newGroup ? 'chip active' : 'chip'}
                onClick={() => pickNewGroup(g)}
              >
                {g}
              </button>
            ))}
          </div>

          {submusclesOf(newGroup).length > 0 && (
            <>
              <div className="create-label">Основная мышца</div>
              <div className="chips">
                {submusclesOf(newGroup).map((s) => (
                  <button
                    key={s}
                    className={s === newSub ? 'chip active' : 'chip'}
                    onClick={() => {
                      setNewSub(s)
                      setNewSecondary((sec) => sec.filter((x) => x !== s))
                    }}
                  >
                    {labelOf(s)}
                  </button>
                ))}
              </div>
            </>
          )}

          {newSub && (
            <>
              <div className="create-label">Вторичные мышцы <span className="muted">(необязательно)</span></div>
              <div className="chips wrap">
                {secondaryOptionsFor(newSub).map((s) => {
                  const on = newSecondary.includes(s)
                  return (
                    <button
                      key={s}
                      className={on ? 'chip active' : 'chip'}
                      onClick={() =>
                        setNewSecondary((sec) => (on ? sec.filter((x) => x !== s) : [...sec, s]))
                      }
                    >
                      {labelOf(s)}<span className="chip-major"> · {majorOf(s)}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {error && <p className="error create-error">{error}</p>}

          <button
            className="btn primary full create-save"
            disabled={busy}
            onClick={submitCreate}
          >
            {busy ? 'Сохранение…' : 'Сохранить и добавить'}
          </button>
          </div>
      </SheetDialog>
    )
  }

  // ---------------------------- список/поиск --------------------------------
  return (
    <SheetDialog title={title} onDismiss={onClose}>
        <input
          className="search"
          data-autofocus
          placeholder="Поиск по названию…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        <div className="chips">
          {groups.map((g) => (
            <button
              key={g}
              className={g === group ? 'chip active' : 'chip'}
              onClick={() => setGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>

        <div className="picker-list">
          {showShortcuts && shortcuts.recent.length > 0 && (
            <>
              <div className="group-title">Недавние</div>
              {shortcuts.recent.map((e) => (
                <button key={`recent:${e.id}`} className="picker-item" onClick={() => onPick(e)}>
                  <span>{e.name}</span>
                  <span className="picker-group">{e.muscle_group}</span>
                </button>
              ))}
            </>
          )}
          {showShortcuts && shortcuts.frequent.length > 0 && (
            <>
              <div className="group-title">Частые</div>
              {shortcuts.frequent.map((e) => (
                <button key={`frequent:${e.id}`} className="picker-item" onClick={() => onPick(e)}>
                  <span>{e.name}</span>
                  <span className="picker-group">{e.muscle_group}</span>
                </button>
              ))}
            </>
          )}
          {showShortcuts && shortcutIds.size > 0 && <div className="group-title">Все упражнения</div>}
          {mainList.map((e) => (
            <button key={e.id} className="picker-item" onClick={() => onPick(e)}>
              <span>{e.name}</span>
              <span className="picker-group">{e.muscle_group}</span>
            </button>
          ))}
          {byMuscle.length > 0 && (
            <>
              <div className="group-title">По мышцам</div>
              {byMuscle.map((e) => (
                <button key={`muscle:${e.id}`} className="picker-item" onClick={() => onPick(e)}>
                  <span>{e.name}</span>
                  <span className="picker-group">{e.muscle_group}</span>
                </button>
              ))}
            </>
          )}
          {mainList.length === 0 && byMuscle.length === 0 && shortcutIds.size === 0 && !suggestCreate && (
            <p className="muted">Ничего не найдено.</p>
          )}
          {suggestCreate && (
            <button className="picker-item create-suggest" onClick={openCreate}>
              <span>+ Создать «{qTrim}»</span>
              <span className="picker-group">новое</span>
            </button>
          )}
        </div>

        {onCreate && !suggestCreate && (
          <button className="btn outline full create-open" onClick={openCreate}>
            + добавить своё упражнение
          </button>
        )}
    </SheetDialog>
  )
}
