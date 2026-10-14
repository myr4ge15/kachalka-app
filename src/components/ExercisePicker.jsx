import { Fragment, useState, useMemo, useDeferredValue, useLayoutEffect, useRef } from 'react'
import { findSimilar, findExactDuplicate } from '../lib/similar.js'
import { searchExercises } from '../lib/exerciseSearch.js'
import { submusclesOf, secondaryOptionsFor, labelOf, majorOf, defaultSubmuscleFor } from '../lib/muscles.js'
import SheetDialog from './SheetDialog.jsx'
import { settleScroll } from '../lib/scrollBox.js'
import ExerciseScanner from './ExerciseScanner.jsx'
import ExerciseVoice from './ExerciseVoice.jsx'
import TechniqueSheet, { TechniqueButton } from './TechniqueSheet.jsx'

// Канонические группы мышц из ТЗ (Приложение A / п. 3.2). К ним добавляем
// все группы, реально встретившиеся в справочнике, чтобы ничего не потерять.
const BASE_GROUPS = ['грудь', 'спина', 'ноги', 'плечи', 'бицепс', 'трицепс', 'пресс', 'кардио']

// Подбор упражнения из справочника: поиск по названию + фильтр по группе.
// Если нужного упражнения нет — «+ добавить свое» (ТЗ 3.2 / 4.4): задаем
// название и группу, упражнение сохраняется в общий справочник (onCreate) и
// сразу добавляется в тренировку.
//
// Избранные (v6.5.0): favorites — массив id (свежие сверху), onToggleFavorite(id)
// — переключить звезду. Без onToggleFavorite звезд нет (пикер остается простым
// списком). Звезда — ОТДЕЛЬНАЯ кнопка рядом со строкой, а не внутри нее: вложенные
// кнопки невалидны, и тап по звезде не должен добавлять упражнение.
//
// Подсказки по технике (v8.0.0): techniqueSlugOf(ex) → slug или null. Без него
// кнопок «i» нет (пикер шаблонов). Кнопка — тоже отдельная от строки; лист
// подсказки рисуется рядом с пикером (не внутри его листа), пикер под ним
// остается смонтированным — поиск, группа, прокрутка и фокус не теряются.
export default function ExercisePicker({
  exercises,
  usage = { recent: [], frequent: [] },
  favorites = [],
  onToggleFavorite,
  techniqueSlugOf,
  onPick,
  onPickMany, // набор сканером (8.4.0); нет — сканер в одиночном режиме (замена)
  onClose,
  onCreate,
  title = 'Упражнение',
}) {
  const [technique, setTechnique] = useState(null) // { slug, name } открытой подсказки
  const [query, setQuery] = useState('')
  const searchRef = useRef(null)
  const [scanning, setScanning] = useState(false)
  const [group, setGroup] = useState('все')
  // Строки блока «Избранные», звезду которых тронули в этом открытии:
  // [{ id, at }] — at — позиция строки в блоке в момент тапа. Пока пикер открыт
  // и запрос/группа не менялись, строка стоит на месте (со снятой звездой), а не
  // уезжает из-под пальца (РЕВЬЮ-КОДА-2026-10-02): следующий тап иначе попадал в
  // соседнюю строку. Сбрасывается сменой запроса/группы и закрытием.
  const [pinnedFav, setPinnedFav] = useState([])
  const changeQuery = (v) => { setQuery(v); setPinnedFav([]) }
  const changeGroup = (g) => { setGroup(g); setPinnedFav([]) }


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

  // Группы, предлагаемые в форме создания: канон из ТЗ + все, что есть в базе.
  const createGroups = useMemo(() => {
    const set = new Set(BASE_GROUPS)
    for (const e of exercises) if (e.muscle_group) set.add(e.muscle_group)
    return Array.from(set)
  }, [exercises])

  // Поиск и поиск похожих не блокируют ввод: фильтрация идет по «отложенному»
  // значению (useDeferredValue), пока поле остается отзывчивым на каждую букву —
  // фактический debounce без таймеров. Заметно на мобильном и большом справочнике.
  const deferredQuery = useDeferredValue(query)
  const deferredNewName = useDeferredValue(newName)

  // Новый фильтр — список с начала (v7.1.7). Иначе позиция прошлой группы
  // оставалась: пролистал «спину» вниз, выбрал «бицепс» — его короткий список
  // начинался выше края, а последнее упражнение висело посередине (WebKit не
  // поджимает scrollTop укоротившегося списка, особенно пока тот едет по инерции).
  // settleScroll ставит позицию наверняка, гася инерцию. Первый показ не трогаем;
  // запрос — по отложенному значению, тем же, по которому фильтруется список.
  const listRef = useRef(null)
  const filterKey = group + '\n' + deferredQuery
  const lastFilterKey = useRef(filterKey)
  useLayoutEffect(() => {
    if (lastFilterKey.current === filterKey) return undefined
    lastFilterKey.current = filterKey
    return settleScroll(listRef.current, 0)
  }, [filterKey])

  // Фильтр по группе — сначала (он сужает справочник), умный поиск — по остатку.
  // `byName` — совпадения по названию, `byMuscle` — только по мышце («плеч»).
  const { byName: filtered, byMuscle } = useMemo(() => {
    const inGroup =
      group === 'все' ? exercises : exercises.filter((e) => e.muscle_group === group)
    return searchExercises(deferredQuery, inGroup)
  }, [exercises, deferredQuery, group])

  // Введенного названия нет в справочнике (точного совпадения) → предлагаем
  // создать его прямо из поля. Анти-дубли подтянутся в форме создания (similar).
  const qTrim = deferredQuery.trim()
  // Сверка нормализованная (е/е, пробелы, пунктуация): иначе «жим лежа» звало
  // создать дубль уже существующего «Жим лежа».
  const hasExact = useMemo(
    () => !!qTrim && !!findExactDuplicate(qTrim, exercises),
    [exercises, qTrim]
  )
  // Запрос, попавший ТОЛЬКО в мышцы («плеч»), — это просмотр группы, а не заявка
  // на новое упражнение: предлагать создать «плеч» бессмысленно. Общая кнопка
  // «+ добавить свое упражнение» внизу при этом остается доступной.
  const browsingByMuscle = filtered.length === 0 && byMuscle.length > 0
  const suggestCreate = !!onCreate && !!qTrim && !hasExact && !browsingByMuscle

  // Быстрые блоки: ⭐ Избранные → Недавние → Частые. Упражнение показываем один
  // раз — в самом верхнем блоке, где оно есть (избранное не дублируется в недавних).
  const favSet = useMemo(() => new Set((favorites ?? []).map(String)), [favorites])
  const shortcuts = useMemo(() => {
    const byId = new Map(exercises.map((e) => [String(e.id), e]))
    const resolve = (ids) => (ids ?? []).map((id) => byId.get(String(id))).filter(Boolean)
    // Блок избранного: актуальные звезды + «приколотые» строки на своих местах
    // (вставляем по возрастанию позиции — так восстанавливается порядок серии тапов).
    const pinnedIds = new Set(pinnedFav.map((p) => p.id))
    const favIds = (favorites ?? []).map(String).filter((id) => !pinnedIds.has(id))
    for (const p of [...pinnedFav].sort((a, b) => a.at - b.at)) {
      favIds.splice(Math.min(p.at, favIds.length), 0, p.id)
    }
    const fav = resolve(favIds)
    const inFavBlock = new Set(fav.map((e) => String(e.id)))
    const notFav = (e) => !inFavBlock.has(String(e.id))
    return {
      fav,
      recent: resolve(usage.recent).filter(notFav),
      frequent: resolve(usage.frequent).filter(notFav),
    }
  }, [exercises, usage, favorites, pinnedFav])
  const showShortcuts = !qTrim && group === 'все'
  const shortcutIds = useMemo(
    () => new Set([...shortcuts.fav, ...shortcuts.recent, ...shortcuts.frequent].map((e) => e.id)),
    [shortcuts]
  )

  // Тап по звезде в блоке «Избранные» — прикалываем строку к ее месту.
  function toggleFavInBlock(e, at) {
    const id = String(e.id)
    setPinnedFav((prev) => (prev.some((p) => p.id === id) ? prev : [...prev, { id, at }]))
    onToggleFavorite(e.id)
  }

  // Строка списка: («i» подсказки слева, если включены) + упражнение + (если
  // включено избранное) звезда справа. onStar — свой обработчик звезды (блок избранного),
  // иначе просто переключение.
  function row(e, keyPrefix = '', onStar = null) {
    const item = (
      <button className="picker-item" onClick={() => onPick(e)}>
        <span>{e.name}</span>
        <span className="picker-group">{e.muscle_group}</span>
      </button>
    )
    const slug = techniqueSlugOf?.(e) ?? null
    // «i» — слева от названия (v8.0.0). Когда подсказки в пикере включены, у строк
    // без подсказки на ее месте пустое место: названия стоят ровной колонкой.
    const info = !techniqueSlugOf ? null : slug ? (
      <TechniqueButton name={e.name} onClick={() => setTechnique({ slug, name: e.name })} />
    ) : <span className="technique-slot" aria-hidden="true" />
    if (!onToggleFavorite) {
      if (!info) return <Fragment key={keyPrefix + e.id}>{item}</Fragment>
      return <div key={keyPrefix + e.id} className="picker-row">{info}{item}</div>
    }
    const on = favSet.has(String(e.id))
    return (
      <div key={keyPrefix + e.id} className="picker-row">
        {info}
        {item}
        <button
          type="button"
          className={'picker-star' + (on ? ' on' : '')}
          aria-pressed={on}
          aria-label={on ? 'Убрать из избранного' : 'В избранное'}
          title={on ? 'Убрать из избранного' : 'В избранное'}
          onClick={() => (onStar ? onStar() : onToggleFavorite(e.id))}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
            fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"
            strokeLinejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
        </button>
      </div>
    )
  }
  const mainList = showShortcuts ? filtered.filter((e) => !shortcutIds.has(e.id)) : filtered

  // Похожие по названию — чтобы не плодить дубли (ТЗ 3.2 / 4.4). Нечеткое
  // сопоставление (нормализация е/е, пробелы, порядок слов, опечатки), а не
  // голый includes(), который дубли вроде «жим лежа»/«жим лежа» пропускает.
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
  if (scanning) return <ExerciseScanner exercises={exercises} onPick={onPick} onPickMany={onPickMany}
    onClose={() => setScanning(false)} onManual={(text) => {
      changeQuery(text); changeGroup('все'); setScanning(false)
    }} />

  if (creating) {
    return (
      // В режиме создания клик по фону = «назад» к списку (setCreating(false)),
      // а НЕ onClose: иначе промах мимо листа стирал заполненную форму, а во время
      // сохранения еще и размонтировал пикер на лету. Во время busy фон не реагирует.
      <SheetDialog
        title="Свое упражнение"
        actionLabel="назад"
        dismissDisabled={busy}
        onDismiss={() => setCreating(false)}
      >
          {/* Форма длиннее экрана (тип + группа + под/вторичные мышцы) — держим ее
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
              Вес и повторения
            </button>
            <button
              className={newMetric === 'reps' ? 'chip active' : 'chip'}
              onClick={() => setNewMetric('reps')}
            >
              Только повторения
            </button>
            <button
              className={newMetric === 'time' ? 'chip active' : 'chip'}
              onClick={() => setNewMetric('time')}
            >
              На время
            </button>
            {/* v6.12.0: бег, ходьба, эллипс, велотренажер — км и время, темп считается. */}
            <button
              className={newMetric === 'distance' ? 'chip active' : 'chip'}
              onClick={() => setNewMetric('distance')}
            >
              Дистанция и время
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
    <>
    <SheetDialog title={title} onDismiss={onClose} className="sheet--picker">
        {/* Без автофокуса (v6.12.0): клавиатура закрывала пол-экрана справочника, а
            чаще упражнение выбирают из списка или чипом группы, а не поиском.
            Нужен поиск — один тап по полю. */}
        <div className={`scanner-search-row${query ? ' has-query' : ''}`}>
          <input
            ref={searchRef}
            className="search"
            placeholder="Поиск по названию…"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
          />
          {/* Крестик (v8.0.0): очистить поиск одним тапом и остаться в поле. */}
          {query && (
            <button type="button" className="search-clear" aria-label="Очистить поиск" title="Очистить поиск"
              onClick={() => { changeQuery(''); searchRef.current?.focus() }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4"
                strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          )}

          <button type="button" className="btn scanner-open" aria-label="Сканировать название" title="Сканировать название" onClick={() => setScanning(true)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><circle cx="11.5" cy="11.5" r="4.5" /><path d="m15 15 4 4" /></svg>
          </button>
        </div>

        <div className="chips">
          {groups.map((g) => (
            <button
              key={g}
              className={g === group ? 'chip active' : 'chip'}
              onClick={() => changeGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>

        <div className="picker-list" ref={listRef} data-sheet-bounce="">
          <ExerciseVoice exercises={exercises} onPick={onPick} />
          {showShortcuts && shortcuts.fav.length > 0 && (
            <>
              <div className="group-title">Избранные</div>
              {shortcuts.fav.map((e, i) => row(e, 'fav:', () => toggleFavInBlock(e, i)))}
            </>
          )}
          {showShortcuts && shortcuts.recent.length > 0 && (
            <>
              <div className="group-title">Недавние</div>
              {shortcuts.recent.map((e) => row(e, 'recent:'))}
            </>
          )}
          {showShortcuts && shortcuts.frequent.length > 0 && (
            <>
              <div className="group-title">Частые</div>
              {shortcuts.frequent.map((e) => row(e, 'frequent:'))}
            </>
          )}
          {showShortcuts && shortcutIds.size > 0 && <div className="group-title">Все упражнения</div>}
          {mainList.map((e) => row(e))}
          {byMuscle.length > 0 && (
            <>
              <div className="group-title">По мышцам</div>
              {byMuscle.map((e) => row(e, 'muscle:'))}
            </>
          )}
          {mainList.length === 0 && byMuscle.length === 0 && !(showShortcuts && shortcutIds.size > 0) && !suggestCreate && (
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
          // v8.4.0: «+» — значком, как у «Упражнение»/«Шаблон» в тренировке: текстовый
          // плюс в Onest стоит выше строчных букв и выглядел не вровень.
          <button className="btn outline full create-open" onClick={openCreate}>
            <svg className="create-open-ico" viewBox="0 0 24 24" width="18" height="18" fill="none"
              stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Добавить свое упражнение
          </button>

        )}
    </SheetDialog>
    {technique && (
      <TechniqueSheet slug={technique.slug} name={technique.name} onClose={() => setTechnique(null)} />
    )}
    </>
  )
}
