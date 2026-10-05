import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Dot,
  ReferenceArea, ReferenceLine,
} from 'recharts'
import { useLiveQuery } from 'dexie-react-hooks'
import { getWorkouts } from '../db/repo.js'
import { readGoals } from '../db/notifications.js'
import { fmtMetricValue, fmtSet as fmtSetMetric, fmtTime } from '../lib/metric.js'
import { collectExercises, buildSeries, seriesValueSpread } from '../lib/progressSeries.js'
import { buildGoalGuide, selectProgressGoal } from '../lib/progressGoal.js'
import { localYmd, toDate } from '../lib/calendar.js'
import CardsSkeleton from '../components/CardsSkeleton.jsx'

function fmtDate(iso) {
  const d = toDate(iso) // 'YYYY-MM-DD' — местный день, а не UTC-полночь
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

// Цвет графика из токенов :root (Recharts нужна строка, var() в его пропсы не
// пробросить). Берем первый непустой из имен, иначе — ключевое слово CSS.
// Без hex-фолбэков (РЕВЬЮ-КОДА-2026-10-02): палитра живет только в index.css,
// а захардкоженный «ночной» цвет при смене палитры молча расходился бы с ней.
// currentColor/Canvas — системные значения, они хотя бы следуют теме страницы.
function cssVar(names, keyword = 'currentColor') {
  if (typeof window === 'undefined') return keyword
  const style = getComputedStyle(document.documentElement)
  for (const name of [].concat(names)) {
    const v = style.getPropertyValue(name).trim()
    if (v) return v
  }
  return keyword
}

const PERIODS = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'all', label: 'Все' },
  { id: 'custom', label: 'Период' },
]

// Окно «формы сейчас» — лучший фактический вес за последние FORM_WEEKS недель.
// Отдельная от «рекорда» метрика, чтобы возврат после паузы отслеживался сам по
// себе и не упирался каждый раз в далекий личный пик.
const FORM_WEEKS = 6

// Границы периода как ISO-дни (YYYY-MM-DD) или null = без ограничения.
// ISO-строки сравниваются лексикографически, поэтому хватает строкового <,>.
function periodRange(period, from, to) {
  if (period === 'all') return null
  if (period === 'custom') return { from: from || null, to: to || null }
  const d = new Date()
  if (period === 'week') d.setDate(d.getDate() - 7)
  else if (period === 'month') d.setMonth(d.getMonth() - 1)
  return { from: localYmd(d), to: null }
}

function inRange(day, range) {
  if (!range) return true
  if (range.from && day < range.from) return false
  if (range.to && day > range.to) return false
  return true
}

export default function ProgressScreen({
  user,
  initialExerciseId = null,
  onConsumed,
  onOpenGoals,
}) {
  const workouts = useLiveQuery(() => getWorkouts(user.id), [user.id])
  const goals = useLiveQuery(() => readGoals(user.id), [user.id])
  const loading = workouts === undefined

  const list = useMemo(() => collectExercises(workouts ?? []), [workouts])
  const [selId, setSelId] = useState(initialExerciseId)

  // Открытие из ЛК по тапу на рекорд: подхватываем переданное упражнение и сразу
  // «гасим» проброс в родителе (one-shot) — иначе progressExId залипал бы, и
  // следующий прямой вход на вкладку «Прогресс» переоткрывал бы то же упражнение
  // вместо дефолта (жим). Сброс делает initialExerciseId=null; гард != null
  // не дает повторно дернуть setSelId — текущий выбор сохраняется.
  useEffect(() => {
    if (initialExerciseId != null) {
      setSelId(initialExerciseId)
      onConsumed?.()
    }
    // onConsumed намеренно вне deps: это инлайн-колбэк родителя (новый на каждый
    // рендер) — добавление в deps гоняло бы эффект вхолостую каждый рендер. Эффект
    // — один раз на смену initialExerciseId (см. коммент выше).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialExerciseId])

  const selected = useMemo(() => {
    if (list.length === 0) return null
    const picked = selId != null && list.find((x) => String(x.id) === String(selId))
    return picked || list.find((x) => x.is_bench_lift) || list[0]
  }, [list, selId])

  // Тип берем из явного metric (приходит в денормализованном снимке упражнения);
  // для легаси-записей без поля — фолбэк на «есть ли вес в подходах» (hasWeight).
  const metric = selected
    ? (selected.metric ?? (selected.hasWeight ? 'weight' : 'reps'))
    : 'weight'
  const weighted = selected
    ? (selected.metric ? selected.metric === 'weight' : selected.hasWeight)
    : true
  // Дистанция (v6.12.0): динамика по самой длинной дистанции дня, км; без 1ПМ.
  const isDistance = metric === 'distance'

  // PR и направление считаем по ВСЕЙ истории (рекорд — личный за все время),
  // а период лишь сужает отображаемые точки. Поэтому строим ряд целиком и
  // фильтруем результат, а не входные тренировки.
  const [ormInfo, setOrmInfo] = useState(false)
  const [period, setPeriod] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const fullData = useMemo(
    () => (selected ? buildSeries(workouts ?? [], selected.id, weighted, { distance: isDistance }) : []),
    [workouts, selected, weighted, isDistance]
  )
  const range = useMemo(() => periodRange(period, from, to), [period, from, to])
  const data = useMemo(() => fullData.filter((p) => inRange(p.day, range)), [fullData, range])
  const rows = useMemo(() => [...data].reverse(), [data])

  const unit = weighted ? 'кг' : isDistance ? 'км' : metric === 'time' ? 'мин:сек' : 'повт.'
  // С большой буквы — как «Дата» и «Подходы» в шапке таблицы и «Вес: 80 кг» в подсказке графика (v6.3.5).
  const metricLabel = weighted ? 'Вес' : isDistance ? 'Дистанция' : metric === 'time' ? 'Время' : 'Повт.'
  // Для упражнений без веса — лучший подход за выбранный период.
  const best = data.reduce((m, p) => Math.max(m, p.value), 0)

  // Шапка весовых упражнений: «рекорд» (макс. вес за всю историю) и «форма
  // сейчас» (лучший вес за последние FORM_WEEKS недель) — обе считаются по ВСЕЙ
  // истории, независимо от выбранного периода графика. 1ПМ — вторично.
  const formCutoff = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - FORM_WEEKS * 7)
    return localYmd(d)
  }, [])
  const allBest = weighted ? fullData.reduce((m, p) => Math.max(m, p.value), 0) : 0
  const allBestOrm = weighted ? fullData.reduce((m, p) => Math.max(m, p.orm || 0), 0) : 0
  const formData = weighted ? fullData.filter((p) => p.day >= formCutoff) : []
  const formBest = formData.reduce((m, p) => Math.max(m, p.value), 0)
  const formBestOrm = formData.reduce((m, p) => Math.max(m, p.orm || 0), 0)
  const fullBest = fullData.reduce((m, p) => Math.max(m, p.value), 0)
  const goal = useMemo(
    () => (selected ? selectProgressGoal(goals, selected.id) : null),
    [goals, selected]
  )
  const goalGuide = useMemo(
    () => buildGoalGuide(goal, fullBest),
    [goal, fullBest]
  )
  const chartDomain = useMemo(() => {
    if (data.length === 0) return [0, 1]
    const values = data.map((p) => p.value)
    if (goalGuide?.target > 0) values.push(goalGuide.target)
    const pad = weighted ? 5 : 2
    return [
      Math.max(0, Math.min(...values) - pad),
      Math.max(...values) + pad,
    ]
  }, [data, goalGuide, weighted])

  const c = useMemo(() => ({
    grid: cssVar(['--border', '--stroke']),
    axis: cssVar(['--muted', '--text']),
    line: cssVar(['--green', '--acc']),
    down: cssVar(['--red']),
    flat: cssVar(['--muted', '--text']),
    pr: cssVar(['--g4', '--yellow']), // цвет рекордов (v6.2.2): как 🏆 и звезды Профиля
    bg: cssVar(['--bg', '--surface-solid'], 'Canvas'),
    border: cssVar(['--border', '--stroke']),
    text: cssVar(['--text'], 'CanvasText'),
    goal: cssVar(['--acc', '--g1']), // цель — выбранный акцент
  }), [])

  // Цвет точки по смыслу: рекорд > спад/рост. Желтый — новый максимум,
  // зеленый — рост к прошлой сессии, красный — спад, серый — без изменений.
  const dotColor = (p) =>
    p.isPr ? c.pr : p.dir === 'down' ? c.down : p.dir === 'flat' ? c.flat : c.line

  // Линию красим посегментно через градиент по оси X: каждый сегмент — своим
  // цветом (рост зеленый / спад красный) с резкой границей (две стоп-точки на
  // одном офсете). При одной точке линии нет — берем сплошной зеленый.
  const gradId = 'progDir'
  const stops = useMemo(() => {
    const n = data.length
    if (n < 2) return []
    const out = []
    for (let i = 0; i < n - 1; i++) {
      const col = data[i + 1].dir === 'down' ? c.down : c.line
      const o1 = (i / (n - 1)) * 100
      const o2 = ((i + 1) / (n - 1)) * 100
      out.push({ off: o1, col }, { off: o2, col })
    }
    return out
  }, [data, c])
  // Градиент рисуем только когда линия НЕ строго горизонтальна: при нулевом
  // размахе значений (все точки на одной высоте) bbox градиента вырождается и
  // штрих не отрисовывается — берем сплошной цвет, чтобы линия была видна.
  const lineStroke = data.length >= 2 && seriesValueSpread(data) > 0 ? `url(#${gradId})` : c.line

  return (
    <div className="screen prog-screen">
      <h2 className="screen-title">Прогресс</h2>
      <p className="muted sub">
        {weighted
          ? <>
              По дням — максимальный поднятый вес.<br />
              {/* v6.3.3: формула Эпли — по нажатию прямо здесь, а не сноской внизу. */}
              <button
                type="button" className="orm-info-link"
                aria-expanded={ormInfo} onClick={() => setOrmInfo((v) => !v)}
              >
                1ПМ (расчетный) — справочно <span className="orm-info-ico" aria-hidden="true">ⓘ</span>
              </button>
            </>
          : isDistance
            ? 'Дистанция — динамика по самой длинной за день (км)'
            : metric === 'time'
            ? 'Упражнение на время — динамика по лучшему подходу (мин:сек)'
            : 'Упражнение без веса — динамика по лучшему подходу (повт.)'}
      </p>
      {weighted && ormInfo && (
        <p className="formula-note">
          1ПМ считается по формуле Эпли:{' '}
          <code>вес × (1 + повторения ÷ 30)</code>. Это расчетная оценка
          максимума «на раз», а не результат реального теста — чем больше
          повторений в подходе, тем выше погрешность.
        </p>
      )}

      {loading && <CardsSkeleton cards={3} />}

      {!loading && list.length === 0 && (
        <p className="muted empty">Пока нет данных. Запиши тренировку.</p>
      )}

      {!loading && list.length > 0 && selected && (
        <>
          {/* Десктоп (≥900px) раскладывает это в две колонки: слева контролы
              (выбор упражнения + период), справа сводка/график/таблица. На мобиле
              .prog-layout — обычный блок, все стекается как раньше. */}
          <div className="prog-layout">
          <div className="prog-aside">
          <label className="prog-pick">
            <span className="muted">Упражнение</span>
            <select
              className="prog-select"
              value={String(selected.id)}
              onChange={(e) => setSelId(e.target.value)}
            >
              {list.map((x) => (
                <option key={x.id} value={String(x.id)}>
                  {x.name}{x.is_bench_lift ? ' 🏅' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="prog-periods">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                className={`prog-chip${period === p.id ? ' active' : ''}`}
                onClick={() => setPeriod(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {period === 'custom' && (
            <div className="prog-range">
              <label>
                <span>С</span>
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                <span>По</span>
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          )}
          </div>

          <div className="prog-main">
          {data.length === 0 ? (
            <p className="muted empty">
              {fullData.length > 0
                ? 'Нет подходов за выбранный период.'
                : 'Нет подходов по этому упражнению.'}
            </p>
          ) : (
            <>
              {weighted ? (
                <div className="card stat-duo">
                  {formBest > 0 && formBest === allBest ? (
                    // v6.5.1: рекорд поставлен в окне формы — две плитки с одним числом
                    // говорили одно и то же. Одна плитка, вторая подпись — о свежести.
                    <div className="stat-duo-row one">
                      <div className="stat-cell">
                        <span className="stat-cell-label">Рекорд — и это твоя форма сейчас</span>
                        <span className="stat-num gold">{allBest} кг</span>
                        <span className="muted stat-sub">поставлен за последние {FORM_WEEKS} нед.</span>
                      </div>
                    </div>
                  ) : (
                  <div className="stat-duo-row">
                    <div className="stat-cell">
                      <span className="stat-cell-label">Рекорд</span>
                      <span className="stat-num gold">{allBest} кг</span>
                      <span className="muted stat-sub">за все время</span>
                    </div>
                    <div className="stat-cell stat-cell-right">
                      <span className="stat-cell-label">Форма сейчас</span>
                      <span className="stat-num">{formBest > 0 ? `${formBest} кг` : '—'}</span>
                      <span className="muted stat-sub">лучшее за {FORM_WEEKS} нед.</span>
                    </div>
                  </div>
                  )}
                  {/* 1ПМ не считается для подходов > 12 повторов — нечего показывать. */}
                  {allBestOrm > 0 && (
                    <div className="muted stat-orm-note">
                      в теории (1ПМ): рекорд ~{allBestOrm}
                      {formBestOrm > 0 && formBestOrm !== allBestOrm ? ` · сейчас ~${formBestOrm}` : ''} кг
                    </div>
                  )}
                </div>
              ) : (
                <div className="card stat">
                  <span className="stat-num">{metric === 'time' ? fmtTime(best) : `${best} ${unit}`}</span>
                  <span className="muted">лучший подход за день</span>
                </div>
              )}

              <div className="card chart-card">
                {goalGuide && (
                  <button
                    className="prog-goal-guide"
                    onClick={() => onOpenGoals?.()}
                    aria-label={`Открыть цель ${selected.name}`}
                  >
                    <span className="prog-goal-mark" aria-hidden="true">🎯</span>
                    <span className="prog-goal-copy">
                      <span className="prog-goal-title">
                        Цель · {fmtMetricValue(goalGuide.metric, goalGuide.target)}
                        {goalGuide.reps ? ` × ${goalGuide.reps}` : ''}
                      </span>
                      <span className="prog-goal-sub">
                        {goalGuide.left > 0
                          ? `осталось: ${fmtMetricValue(goalGuide.metric, goalGuide.left)}`
                          : goalGuide.reps
                            ? `вес уже есть · осталось выполнить ≥${goalGuide.reps} повт.`
                            : 'целевой показатель уже достигнут'}
                      </span>
                    </span>
                    <span className="prog-goal-go" aria-hidden="true">›</span>
                  </button>
                )}
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
                        {stops.map((s, idx) => (
                          <stop key={idx} offset={`${s.off}%`} stopColor={s.col} />
                        ))}
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                    <XAxis dataKey="day" tickFormatter={fmtDate} stroke={c.axis} fontSize={12} />
                    <YAxis
                      stroke={c.axis}
                      fontSize={12}
                      domain={chartDomain}
                    />
                    {goalGuide && goalGuide.target !== fullBest && (
                      <ReferenceArea
                        y1={Math.min(fullBest, goalGuide.target)}
                        y2={Math.max(fullBest, goalGuide.target)}
                        fill={c.goal}
                        fillOpacity={0.07}
                        ifOverflow="extendDomain"
                      />
                    )}
                    {goalGuide && (
                      <ReferenceLine
                        y={goalGuide.target}
                        stroke={c.goal}
                        strokeWidth={2}
                        strokeDasharray="6 5"
                        ifOverflow="extendDomain"
                        label={{
                          value: `цель ${fmtMetricValue(goalGuide.metric, goalGuide.target)}`,
                          position: 'insideTopRight',
                          fill: c.goal,
                          fontSize: 11,
                        }}
                      />
                    )}
                    <Tooltip
                      labelFormatter={(v) => fmtDate(v)}
                      separator=": "
                      formatter={(v) => [metric === 'time' ? fmtTime(v) : `${v} ${unit}`, metricLabel]}
                      contentStyle={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8 }}
                      labelStyle={{ color: c.text }}
                    />
                    <Line
                      type="monotone" dataKey="value" stroke={lineStroke} strokeWidth={2}
                      dot={(props) => {
                        const { cx, cy, payload, index } = props
                        return (
                          <Dot
                            key={`dot-${index}`}
                            cx={cx} cy={cy} r={payload.isPr ? 5 : 3}
                            fill={dotColor(payload)}
                            stroke={c.bg}
                          />
                        )
                      }}
                      activeDot={(props) => {
                        const { cx, cy, payload, index } = props
                        return (
                          <Dot
                            key={`active-dot-${index}`}
                            cx={cx} cy={cy} r={payload.isPr ? 6 : 5}
                            fill={dotColor(payload)}
                            stroke={c.text}
                          />
                        )
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
                {/* Легенда — классы с токенами (v6.2.2), без инлайн-цвета. */}
                <p className="muted legend">
                  <span className="lg lg-up"><i aria-hidden="true" />рост</span>
                  <span className="lg lg-down"><i aria-hidden="true" />спад</span>
                  <span className="lg lg-pr"><i aria-hidden="true" />рекорд</span>
                </p>
              </div>

              <div className="card prog-card">
                <h3 className="prog-table-title">По дням</h3>
                <div className="prog-table">
                  <div className="prog-row prog-row-head">
                    <span>Дата</span>
                    <span>Подходы ({weighted ? 'кг×повт.' : unit})</span>
                    <span className="prog-val">{metricLabel}</span>
                  </div>
                  {rows.map((r) => (
                    <div key={r.day} className={`prog-row${r.isPr ? ' pr' : ''}`}>
                      <span>{fmtDate(r.day)}</span>
                      <span className="prog-sets">
                        {r.sets.map((s) => fmtSetMetric(metric, s)).join(', ')}
                      </span>
                      <span className="prog-val">
                        {metric === 'time' ? fmtTime(r.value) : r.value}{r.isPr ? ' 🏆' : ''}
                        {weighted && r.orm > 0 && <span className="prog-orm">1ПМ {r.orm}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

            </>
          )}
          </div>
          </div>
        </>
      )}
    </div>
  )
}
