import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Dot,
} from 'recharts'
import { useLiveQuery } from 'dexie-react-hooks'
import { getWorkouts } from '../db/repo.js'
import { fmtSet as fmtSetMetric, fmtTime } from '../lib/metric.js'
import { collectExercises, buildSeries, seriesValueSpread } from '../lib/progressSeries.js'
import CardsSkeleton from '../components/CardsSkeleton.jsx'

function fmtDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

function cssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const PERIODS = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'all', label: 'Всё' },
  { id: 'custom', label: 'Период' },
]

// Окно «формы сейчас» — лучший фактический вес за последние FORM_WEEKS недель.
// Отдельная от «рекорда» метрика, чтобы возврат после паузы отслеживался сам по
// себе и не упирался каждый раз в далёкий личный пик.
const FORM_WEEKS = 6

// Границы периода как ISO-дни (YYYY-MM-DD) или null = без ограничения.
// ISO-строки сравниваются лексикографически, поэтому хватает строкового <,>.
function periodRange(period, from, to) {
  if (period === 'all') return null
  if (period === 'custom') return { from: from || null, to: to || null }
  const d = new Date()
  if (period === 'week') d.setDate(d.getDate() - 7)
  else if (period === 'month') d.setMonth(d.getMonth() - 1)
  return { from: d.toISOString().slice(0, 10), to: null }
}

function inRange(day, range) {
  if (!range) return true
  if (range.from && day < range.from) return false
  if (range.to && day > range.to) return false
  return true
}

export default function ProgressScreen({ user, initialExerciseId = null, onConsumed }) {
  const workouts = useLiveQuery(() => getWorkouts(user.id), [user.id])
  const loading = workouts === undefined

  const list = useMemo(() => collectExercises(workouts ?? []), [workouts])
  const [selId, setSelId] = useState(initialExerciseId)

  // Открытие из ЛК по тапу на рекорд: подхватываем переданное упражнение и сразу
  // «гасим» проброс в родителе (one-shot) — иначе progressExId залипал бы, и
  // следующий прямой вход на вкладку «Прогресс» переоткрывал бы то же упражнение
  // вместо дефолта (жим). Сброс делает initialExerciseId=null; гард != null
  // не даёт повторно дёрнуть setSelId — текущий выбор сохраняется.
  useEffect(() => {
    if (initialExerciseId != null) {
      setSelId(initialExerciseId)
      onConsumed?.()
    }
  }, [initialExerciseId])

  const selected = useMemo(() => {
    if (list.length === 0) return null
    const picked = selId != null && list.find((x) => String(x.id) === String(selId))
    return picked || list.find((x) => x.is_bench_lift) || list[0]
  }, [list, selId])

  // Тип берём из явного metric (приходит в денормализованном снимке упражнения);
  // для легаси-записей без поля — фолбэк на «есть ли вес в подходах» (hasWeight).
  const metric = selected
    ? (selected.metric ?? (selected.hasWeight ? 'weight' : 'reps'))
    : 'weight'
  const weighted = selected
    ? (selected.metric ? selected.metric === 'weight' : selected.hasWeight)
    : true

  // PR и направление считаем по ВСЕЙ истории (рекорд — личный за всё время),
  // а период лишь сужает отображаемые точки. Поэтому строим ряд целиком и
  // фильтруем результат, а не входные тренировки.
  const [period, setPeriod] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const fullData = useMemo(
    () => (selected ? buildSeries(workouts ?? [], selected.id, weighted) : []),
    [workouts, selected, weighted]
  )
  const range = useMemo(() => periodRange(period, from, to), [period, from, to])
  const data = useMemo(() => fullData.filter((p) => inRange(p.day, range)), [fullData, range])
  const rows = useMemo(() => [...data].reverse(), [data])

  const unit = weighted ? 'кг' : metric === 'time' ? 'мин:сек' : 'повт.'
  const metricLabel = weighted ? 'вес' : metric === 'time' ? 'время' : 'повт.'
  // Для упражнений без веса — лучший подход за выбранный период.
  const best = data.reduce((m, p) => Math.max(m, p.value), 0)

  // Шапка весовых упражнений: «рекорд» (макс. вес за всю историю) и «форма
  // сейчас» (лучший вес за последние FORM_WEEKS недель) — обе считаются по ВСЕЙ
  // истории, независимо от выбранного периода графика. 1ПМ — вторично.
  const formCutoff = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - FORM_WEEKS * 7)
    return d.toISOString().slice(0, 10)
  }, [])
  const allBest = weighted ? fullData.reduce((m, p) => Math.max(m, p.value), 0) : 0
  const allBestOrm = weighted ? fullData.reduce((m, p) => Math.max(m, p.orm || 0), 0) : 0
  const formData = weighted ? fullData.filter((p) => p.day >= formCutoff) : []
  const formBest = formData.reduce((m, p) => Math.max(m, p.value), 0)
  const formBestOrm = formData.reduce((m, p) => Math.max(m, p.orm || 0), 0)

  const c = useMemo(() => ({
    grid: cssVar('--surface', '#1e293b'),
    axis: cssVar('--muted', '#94a3b8'),
    line: cssVar('--green', '#16a34a'),
    down: cssVar('--red', '#ef4444'),
    flat: cssVar('--muted', '#94a3b8'),
    pr: cssVar('--yellow', '#facc15'),
    bg: cssVar('--bg', '#0f172a'),
    border: cssVar('--border', '#334155'),
    text: cssVar('--text', '#e2e8f0'),
  }), [])

  // Цвет точки по смыслу: рекорд > спад/рост. Жёлтый — новый максимум,
  // зелёный — рост к прошлой сессии, красный — спад, серый — без изменений.
  const dotColor = (p) =>
    p.isPr ? c.pr : p.dir === 'down' ? c.down : p.dir === 'flat' ? c.flat : c.line

  // Линию красим посегментно через градиент по оси X: каждый сегмент — своим
  // цветом (рост зелёный / спад красный) с резкой границей (две стоп-точки на
  // одном офсете). При одной точке линии нет — берём сплошной зелёный.
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
  // штрих не отрисовывается — берём сплошной цвет, чтобы линия была видна.
  const lineStroke = data.length >= 2 && seriesValueSpread(data) > 0 ? `url(#${gradId})` : c.line

  return (
    <div className="screen prog-screen">
      <h2 className="screen-title">Прогресс</h2>
      <p className="muted sub">
        {weighted
          ? 'По дням — максимальный поднятый вес. 1ПМ (расчётный) — справочно'
          : metric === 'time'
            ? 'Упражнение на время — динамика по лучшему подходу (мин:сек)'
            : 'Упражнение без веса — динамика по лучшему подходу (повт.)'}
      </p>

      {loading && <CardsSkeleton cards={3} />}

      {!loading && list.length === 0 && (
        <p className="muted empty">Пока нет данных. Запиши тренировку.</p>
      )}

      {!loading && list.length > 0 && selected && (
        <>
          {/* Десктоп (≥900px) раскладывает это в две колонки: слева контролы
              (выбор упражнения + период), справа сводка/график/таблица. На мобиле
              .prog-layout — обычный блок, всё стекается как раньше. */}
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
                  {x.name}{x.is_bench_lift ? ' ⭐' : ''}
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
                  <div className="stat-duo-row">
                    <div className="stat-cell">
                      <span className="stat-cell-label">🏆 Рекорд</span>
                      <span className="stat-num gold">{allBest} кг</span>
                      <span className="muted stat-sub">за всё время</span>
                    </div>
                    <div className="stat-cell stat-cell-right">
                      <span className="stat-cell-label">Форма сейчас</span>
                      <span className="stat-num">{formBest > 0 ? `${formBest} кг` : '—'}</span>
                      <span className="muted stat-sub">лучшее за {FORM_WEEKS} нед.</span>
                    </div>
                  </div>
                  <div className="muted stat-orm-note">
                    в теории (1ПМ): рекорд ~{allBestOrm}
                    {formBestOrm > 0 ? ` · сейчас ~${formBestOrm}` : ''} кг
                  </div>
                </div>
              ) : (
                <div className="card stat">
                  <span className="stat-num">{metric === 'time' ? fmtTime(best) : `${best} ${unit}`}</span>
                  <span className="muted">лучший подход за день</span>
                </div>
              )}

              <div className="card chart-card">
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
                      domain={weighted ? ['dataMin - 5', 'dataMax + 5'] : [0, 'dataMax + 2']}
                    />
                    <Tooltip
                      labelFormatter={(v) => fmtDate(v)}
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
                <p className="muted legend">
                  <span style={{ color: c.line }}>●</span> зелёный — рост ·{' '}
                  <span style={{ color: c.down }}>●</span> красный — спад ·{' '}
                  <span style={{ color: c.pr }}>●</span> жёлтый — новый рекорд
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
                        {weighted && <span className="prog-orm">1ПМ {r.orm}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {weighted && (
                <p className="formula-note">
                  1ПМ считается по формуле Эпли:{' '}
                  <code>вес × (1 + повторы ÷ 30)</code>. Это расчётная оценка
                  максимума «на раз», а не результат реального теста — чем больше
                  повторов в подходе, тем выше погрешность.
                </p>
              )}
            </>
          )}
          </div>
          </div>
        </>
      )}
    </div>
  )
}
