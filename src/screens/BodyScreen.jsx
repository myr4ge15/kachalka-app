import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import BackButton from '../components/ui/BackButton.jsx'
import Icon from '../components/ui/Icon.jsx'
import MoreMenu from '../components/ui/MoreMenu.jsx'
import CardsSkeleton from '../components/ui/CardsSkeleton.jsx'
import { showToast } from '../components/ui/Toast.jsx'
import BodyChart from '../components/body/BodyChart.jsx'
import BodyEntrySheet from '../components/body/BodyEntrySheet.jsx'
import BodyGoal from '../components/body/BodyGoal.jsx'
import { getBody, deleteBodyEntry, setBodyPrefs } from '../db/body.js'
import { localYmd } from '../lib/calendar.js'
import {
  BODY_FIELDS, liveEntries, weightDays, trendSeries, trendChange, trendPace, toneFor, goalLeft,
  lastWeighIn, lastMeasures, fmtBodyDate, fmtSigned, shiftYmd,
} from '../lib/body.js'

// «Вес и замеры» (PLAN-body-metrics.md, этап 1). Вход — только строка в Профиле.
// Правила «Как не угнетать» (план, решение владельца 27.10.2026) — здесь в разметке:
//   - сверху последнее взвешивание как есть; изменения и темп — по тренду (lib/body.js);
//   - цвет — только 'good' (к своей цели) или обычный текст; красного/желтого нет;
//   - в списке записей — только вес, без разниц с прошлым днем;
//   - «Скрыть цифры» (глаз в шапке, синкается) — ни одного числа веса и обхватов в DOM.
const PERIODS = [
  { id: 30, label: 'Месяц' },
  { id: 90, label: '3 мес' },
  { id: 365, label: 'Год' },
  { id: 0, label: 'Все' },
]
const HIDDEN = '•••'

export default function BodyScreen({ user, onBack }) {
  const body = useLiveQuery(() => getBody(user.id), [user.id])
  const [tab, setTab] = useState('weight')
  const [period, setPeriod] = useState(90)
  const [sheet, setSheet] = useState(null) // { entry?, mode: 'weight' | 'measures' }
  const [menuId, setMenuId] = useState(null)
  const [armDel, setArmDel] = useState(false) // «Удалить» → «Точно удалить?» в том же меню

  const data = useMemo(() => {
    if (!body) return null
    const days = weightDays(body)
    const trend = trendSeries(days)
    return {
      entries: liveEntries(body),
      days,
      trend,
      change: trendChange(trend),
      pace: trendPace(trend),
      last: lastWeighIn(body),
      measures: lastMeasures(body),
    }
  }, [body])

  if (!body || !data) {
    return (
      <div className="screen body-screen">
        <div className="detail-head"><BackButton onClick={onBack} /><h2 className="screen-title detail-title">Вес и замеры</h2></div>
        <CardsSkeleton cards={2} />
      </div>
    )
  }

  const hide = body.hide
  const goal = body.goal
  const current = data.trend.length ? data.trend[data.trend.length - 1].value : null
  const view = tab
  const any = data.entries.length > 0
  const from = period ? shiftYmd(localYmd(new Date()), -period) : ''
  const pDays = data.days.filter((d) => d.date >= from)
  const pTrend = data.trend.filter((d) => d.date >= from)

  async function remove(e) {
    if (!armDel) { setArmDel(true); return }
    setMenuId(null)
    setArmDel(false)
    try {
      await deleteBodyEntry(user.id, e.id)
      showToast({ icon: 'trash', title: 'Запись удалена' })
    } catch (err) {
      showToast({ icon: 'alert', title: 'Не удалось удалить', sub: String(err?.message ?? err) })
    }
  }

  // Записи вкладки: во «Вес» — взвешивания (только вес, без разниц), в «Замеры» — строки обхватов.
  // Вкладки не дублируют друг друга (fb_6114e96f).
  function entryList(items, kind) {
    if (!items.length) return null
    return (
      <section className="sec">
        <p className="sec-title">Записи</p>
        <ul className="body-list">
          {items.map((e) => {
            const sub = [kind === 'measures' && !hide && measuresLine(e), e.note].filter(Boolean).join(' · ')
            return (
              <li key={e.id} className="body-row">
                <div className="body-row-main">
                  <span className="body-row-date">{fmtBodyDate(e.date)}</span>
                  <span className="body-row-w">{hide ? HIDDEN : kind === 'weight' ? `${e.weight} кг` : ''}</span>
                </div>
                {sub && <div className="body-row-sub">{sub}</div>}
                <MoreMenu label={`Запись ${fmtBodyDate(e.date)}`} btnClassName="body-more" open={menuId === e.id}
                  onToggle={() => { setArmDel(false); setMenuId((id) => (id === e.id ? null : e.id)) }} onClose={() => { setArmDel(false); setMenuId(null) }}>
                  <button type="button" role="menuitem" onClick={() => { setMenuId(null); setSheet({ entry: e }) }}>Править</button>
                  <button type="button" role="menuitem" className="danger" onClick={() => remove(e)}>{armDel ? 'Точно удалить?' : 'Удалить'}</button>
                </MoreMenu>
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  // «Что делает глазик?» (fb_6114e96f) — подпись на кнопке и тост с объяснением после нажатия.
  function toggleHide() {
    setBodyPrefs(user.id, { hide: !hide }).then(() => showToast(hide
      ? { icon: 'eye', title: 'Цифры снова видны' }
      : { icon: 'eyeoff', title: 'Цифры скрыты', sub: 'Вес и замеры не видны на экране, график — только направление. На всех твоих устройствах.' }))
      .catch(() => {})
  }

  return (
    <div className="screen body-screen">
      <div className="detail-head">
        <BackButton onClick={onBack} />
        <h2 className="screen-title detail-title">Вес и замеры</h2>
        {/* Без записей прятать нечего — кнопки нет (иначе непонятно, что она делает). */}
        {any && (
          <button type="button" className="body-eye" aria-pressed={hide}
            aria-label={hide ? 'Показать цифры' : 'Скрыть цифры'} onClick={toggleHide}>
            <Icon name={hide ? 'eyeoff' : 'eye'} size={18} />
            <span className="body-eye-txt">{hide ? 'показать' : 'скрыть'}</span>
          </button>
        )}
      </div>

      {/* Вкладки видны всегда (fb_6114e96f): у каждой свой лист записи — вес отдельно, замеры отдельно. */}
      <div className="seg body-tabs" role="tablist" aria-label="Раздел">
        <button type="button" role="tab" aria-selected={view === 'weight'} className={`seg-item${view === 'weight' ? ' on' : ''}`} onClick={() => setTab('weight')}>Вес</button>
        <button type="button" role="tab" aria-selected={view === 'measures'} className={`seg-item${view === 'measures' ? ' on' : ''}`} onClick={() => setTab('measures')}>Замеры</button>
      </div>

      {view === 'weight' && (
        <>
          {data.last ? (
            <section className="sec">
              <div className="card body-now">
                <p className="body-now-k">Последняя запись · {fmtBodyDate(data.last.date)}</p>
                <p className="body-now-v">{hide ? HIDDEN : <>{data.last.weight}<span className="body-unit"> кг</span></>}</p>
                {!hide && <NowStats change={data.change} pace={data.pace} goal={goal} current={current} />}
                {hide && <p className="body-hint">Цифры скрыты. График показывает только направление.</p>}
              </div>
            </section>
          ) : (
            <section className="sec">
              <div className="card body-empty">
                <p className="body-empty-title">Записей пока нет</p>
                <p className="body-hint">По желанию: вес и замеры видишь только ты. В Ленту, круги и рейтинги они не попадают.</p>
              </div>
            </section>
          )}

          {data.days.length > 1 && (
            <section className="sec">
              <div className="card chart-card body-chart-card">
                <div className="seg" role="group" aria-label="Период графика">
                  {PERIODS.map((p) => (
                    <button key={p.id} type="button" className={`seg-item${period === p.id ? ' on' : ''}`}
                      aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</button>
                  ))}
                </div>
                {pDays.length ? (
                  <BodyChart days={pDays} trend={pTrend} goal={goal} hide={hide} />
                ) : (
                  <p className="body-hint">За этот период записей нет.</p>
                )}
                <p className="body-legend" aria-hidden="true">
                  <span className="bc-key bc-key--trend" />тренд
                  <span className="bc-key bc-key--dot" />взвешивание
                  {goal && <><span className="bc-key bc-key--goal" />цель</>}
                </p>
              </div>
            </section>
          )}

          <div className="btn-row">
            <button type="button" className="btn primary" onClick={() => setSheet({ mode: 'weight' })}>
              <Icon name="plus" size={18} /> Записать вес
            </button>
          </div>

          <BodyGoal userId={user.id} goal={goal} current={current} pace={data.pace} hide={hide} />

          {entryList(data.entries.filter((e) => e.weight != null), 'weight')}
        </>
      )}

      {view === 'measures' && (
        <>
          <section className="sec">
            {Object.keys(data.measures).length ? (
              <div className="card body-measures-card">
                <ul className="body-list">
                  {BODY_FIELDS.filter((f) => data.measures[f.id] && body.fields.includes(f.id)).map((f) => {
                    const m = data.measures[f.id]
                    return (
                      <li key={f.id} className="body-row">
                        <div className="body-row-main">
                          <span className="body-row-date">{f.label}</span>
                          <span className="body-row-w">{hide ? HIDDEN : `${m.value} см`}</span>
                        </div>
                        <div className="body-row-sub">
                          {fmtBodyDate(m.date)}
                          {!hide && m.delta != null && ` · за ${m.days} дн. ${m.delta === 0 ? 'без изменений' : fmtSigned(m.delta)}`}
                        </div>
                      </li>
                    )
                  })}
                </ul>
                <p className="body-hint">Обхваты — без цветов: у каждого свое «хорошо».</p>
              </div>
            ) : (
              <div className="card body-empty">
                <p className="body-empty-title">Замеров пока нет</p>
                <p className="body-hint">По желанию: талия, грудь, ягодицы, бицепс, бедро — включи в листе только те, что ведешь.</p>
              </div>
            )}
          </section>
          <div className="btn-row">
            <button type="button" className="btn primary" onClick={() => setSheet({ mode: 'measures' })}>
              <Icon name="plus" size={18} /> Записать замеры
            </button>
          </div>
          {entryList(data.entries.filter((e) => measuresLine(e)), 'measures')}
        </>
      )}

      {sheet && (
        <BodyEntrySheet userId={user.id} body={body} entry={sheet.entry ?? null} mode={sheet.mode}
          last={data.last} onClose={() => setSheet(null)} />
      )}
    </div>
  )
}

// Строка «талия 84 · грудь 102» под записью.
function measuresLine(e) {
  return BODY_FIELDS.filter((f) => e[f.id] != null).map((f) => `${f.label.toLowerCase()} ${e[f.id]}`).join(' · ')
}

// Изменение за ~30 дней, темп и «до цели». Тон — только toneFor: 'good' или обычный текст.
function NowStats({ change, pace, goal, current }) {
  const left = goalLeft(goal, current)
  const items = []
  if (change) {
    items.push({
      k: 'change',
      v: change.delta === 0 ? 'без изменений' : fmtSigned(change.delta),
      s: `за ${change.days} дн.`,
      tone: toneFor(change.delta, goal, current),
    })
  }
  if (pace != null && pace !== 0) items.push({ k: 'pace', v: fmtSigned(pace), s: 'кг в неделю', tone: toneFor(pace, goal, current) })
  if (left) {
    items.push(goal.kind === 'keep'
      ? { k: 'goal', v: left.reached ? 'в цели' : `${left.left}`, s: left.reached ? `коридор ${goal.target} ±1.5` : 'до коридора цели', tone: left.reached ? 'good' : 'neutral' }
      : { k: 'goal', v: left.reached ? 'цель' : `${left.left}`, s: left.reached ? 'достигнута' : `до цели ${goal.target}`, tone: left.reached ? 'good' : 'neutral' })
  }
  if (!items.length) return null
  return (
    <div className="body-stats">
      {items.map((it) => (
        <div key={it.k} className="body-stat">
          <span className={`body-stat-v${it.tone === 'good' ? ' body-good' : ''}`}>{it.v}</span>
          <span className="body-stat-k">{it.s}</span>
        </div>
      ))}
    </div>
  )
}
