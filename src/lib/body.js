// ============================================================================
// «Вес и замеры» (PLAN-body-metrics.md, этап 1) — ЧИСТАЯ логика.
//
// Вес здесь — мерило для силы и личный учет, а не оценка тела. Правила «Как не
// угнетать» (решение владельца 27.10.2026) живут в коде, а не только в плане:
//   - тон числа — только 'good' или 'neutral' (toneFor); «плохого» тона нет вообще;
//   - изменения считаются по сглаженному ряду (среднее за 7 дней), а не утро к утру;
//   - прогноз даты — только когда тренд идет к цели, иначе его просто нет.
//
// Значение — синкаемый род `body` в user_meta (ключ body_${userId}):
//   { v: 1, entries: [...], goal: {...}|null, fields: ['waist'], hide: false, at: ISO }
// entries — свежие сверху; удаление — надгробие del:true (живет 90 дней), чтобы
// офлайн-удаление на одном телефоне не воскресло из второго при слиянии.
// at — время последней правки goal/fields/hide (LWW этих настроек, см. mergeBody).
// ============================================================================
import { localYmd, toDate } from './calendar.js'
import { cmpIsoAsc } from './cmp.js'
import { toNum } from './setLimits.js'

export const WEIGHT_MIN = 20
export const WEIGHT_MAX = 350
export const CM_MIN = 10
export const CM_MAX = 250
export const NOTE_MAX = 80
// Коридор цели «держать вес»: попадание в ±1.5 кг — уже «держишь».
export const KEEP_BAND = 1.5
// Окно сглаживания тренда (дней, включая сам день).
export const TREND_DAYS = 7
// Записи свежее года храним все, старше — одну на неделю; надгробия — 90 дней.
export const KEEP_ALL_DAYS = 365
export const TOMBSTONE_DAYS = 90
// Бюджет документа с запасом до лимита upsert_user_meta (64 КБ): не влезло — окно «все
// записи» сужается по шагам (KEEP_ALL_STEPS), старое остается по одной записи на неделю.
export const BODY_BUDGET = 60000
const KEEP_ALL_STEPS = [KEEP_ALL_DAYS, 180, 90, 30]
// «Вес на дату» старше этого не используется (связки молча не показываются).
export const WEIGHT_FRESH_DAYS = 30

// Обхваты, которые человек может вести (по умолчанию — ни одного). Порядок = порядок в форме.
export const BODY_FIELDS = [
  { id: 'waist', label: 'Талия' },
  { id: 'chest', label: 'Грудь' },
  { id: 'hips', label: 'Ягодицы' },
  { id: 'arm', label: 'Бицепс' },
  { id: 'thigh', label: 'Бедро' },
]
const FIELD_IDS = BODY_FIELDS.map((f) => f.id)
export const GOAL_KINDS = ['down', 'up', 'keep']

const DAY_MS = 86400000
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

// Дни между двумя 'YYYY-MM-DD' (b − a), по местному полудню — без сдвига на смене часов.
export function daysBetween(a, b) {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS)
}

export function shiftYmd(ymd, days) {
  const d = toDate(ymd)
  d.setDate(d.getDate() + days)
  return localYmd(d)
}

const round1 = (v) => Math.round(v * 10) / 10

// Вес из ввода (строка или число, запятая допустима) → кг с шагом 0.1 или null.
export function parseWeight(v) {
  const n = toNum(v)
  if (!Number.isFinite(n) || n < WEIGHT_MIN || n > WEIGHT_MAX) return null
  return round1(n)
}

// Обхват → см с шагом 0.1 или null (пусто и мусор — «не мерил»).
export function parseCm(v) {
  if (v == null || v === '') return null
  const n = toNum(v)
  if (!Number.isFinite(n) || n < CM_MIN || n > CM_MAX) return null
  return round1(n)
}

// Одна запись из чего угодно → чистая запись или null (мусор отбрасываем молча:
// значение пришло с сервера или из файла, ронять экран из-за него нельзя).
// Запись без веса допустима, если в ней есть хоть один обхват (замерился, не взвешиваясь).
export function normalizeEntry(e) {
  if (!e || typeof e !== 'object' || !e.id || !YMD_RE.test(String(e.date ?? ''))) return null
  const out = { id: String(e.id), date: String(e.date) }
  if (e.del) return { ...out, at: String(e.at ?? ''), del: true }
  const w = parseWeight(e.weight)
  if (w != null) out.weight = w
  for (const f of FIELD_IDS) {
    const cm = parseCm(e[f])
    if (cm != null) out[f] = cm
  }
  if (out.weight == null && !FIELD_IDS.some((f) => out[f] != null)) return null
  const note = typeof e.note === 'string' ? e.note.trim().slice(0, NOTE_MAX) : ''
  if (note) out.note = note
  out.at = String(e.at ?? '')
  return out
}

function normalizeGoal(g) {
  if (!g || typeof g !== 'object' || !GOAL_KINDS.includes(g.kind)) return null
  const target = parseWeight(g.target)
  if (target == null) return null
  const from = parseWeight(g.from)
  return {
    kind: g.kind,
    target,
    from: from ?? null,
    set: YMD_RE.test(String(g.set ?? '')) ? String(g.set) : null,
  }
}

// Свежие сверху: по дню, затем по времени правки, затем по id (детерминированно для слияния).
function cmpEntryDesc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  const t = cmpIsoAsc(b.at, a.at)
  if (t) return t
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

// Документ целиком из meta/сервера/файла → чистый документ (пустой, если там мусор).
export function normalizeBody(v) {
  const src = v && typeof v === 'object' ? v : {}
  const seen = new Map()
  for (const raw of Array.isArray(src.entries) ? src.entries : []) {
    const e = normalizeEntry(raw)
    if (!e) continue
    const prev = seen.get(e.id)
    if (!prev || cmpIsoAsc(prev.at, e.at) < 0) seen.set(e.id, e)
  }
  const fields = Array.isArray(src.fields) ? FIELD_IDS.filter((f) => src.fields.includes(f)) : []
  return {
    v: 1,
    entries: [...seen.values()].sort(cmpEntryDesc),
    goal: normalizeGoal(src.goal),
    fields,
    hide: Boolean(src.hide),
    at: typeof src.at === 'string' ? src.at : '',
  }
}

export const emptyBody = () => normalizeBody(null)

// Живые записи (без надгробий), свежие сверху.
export function liveEntries(body) {
  return normalizeBody(body).entries.filter((e) => !e.del)
}

// Есть ли у человека хоть одна запись — от этого зависят подпись в Профиле и экран.
export const hasEntries = (body) => liveEntries(body).length > 0

// Неделя для компактора: понедельник недели записи.
function weekKey(ymd) {
  const d = toDate(ymd)
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return localYmd(d)
}

// Компактор (лимит 64 КБ у upsert_user_meta): последние KEEP_ALL_DAYS дней — все,
// старше — одна (самая свежая) запись на неделю, надгробия старше TOMBSTONE_DAYS — вон.
// Не влезло в BODY_BUDGET (годы ежедневных записей с обхватами) — то же с окном 180/90/30.
// Детерминирован: два устройства, слив одно и то же, получат одно и то же.
export function compactBody(body, today = localYmd(new Date())) {
  const b = normalizeBody(body)
  let out = b
  for (const keepDays of KEEP_ALL_STEPS) {
    out = compactWith(b, today, keepDays)
    if (JSON.stringify(out).length <= BODY_BUDGET) break
  }
  return out
}

function compactWith(b, today, keepDays) {
  const keepFrom = shiftYmd(today, -keepDays)
  const tombFrom = shiftYmd(today, -TOMBSTONE_DAYS)
  const weeks = new Set()
  const entries = []
  for (const e of b.entries) { // уже свежие сверху
    if (e.del) {
      const when = e.at ? localYmd(e.at) : e.date
      if (when >= tombFrom) entries.push(e)
      continue
    }
    if (e.date >= keepFrom) { entries.push(e); continue }
    const wk = weekKey(e.date)
    if (weeks.has(wk)) continue
    weeks.add(wk)
    entries.push(e)
  }
  return { ...b, entries }
}

// Слияние двух устройств: записи — объединение по id, внутри id побеждает более
// поздняя правка (at); надгробие — такая же правка. goal/fields/hide — LWW по at
// документа; при равенстве — preferLocal (как у прочих родов user_meta).
export function mergeBody(local, remote, preferLocal = true, today) {
  const a = normalizeBody(local)
  const b = normalizeBody(remote)
  const byId = new Map()
  for (const e of [...a.entries, ...b.entries]) {
    const prev = byId.get(e.id)
    if (!prev) { byId.set(e.id, e); continue }
    const c = cmpIsoAsc(prev.at, e.at)
    // prev — из local (идут первыми): при равных at остается он, если preferLocal.
    if (c < 0 || (c === 0 && !preferLocal)) byId.set(e.id, e)
  }
  const c = cmpIsoAsc(a.at, b.at)
  const settings = c > 0 || (c === 0 && preferLocal) ? a : b
  return compactBody({
    v: 1,
    entries: [...byId.values()],
    goal: settings.goal,
    fields: settings.fields,
    hide: settings.hide,
    at: settings.at,
  }, today)
}

// ----------------------------- правки ---------------------------------------
// Все возвращают НОВЫЙ документ (для updateSyncedMeta) уже после компактора.

// Записать/поправить запись. entry — {id, date, weight?, <обхваты>?, note?}.
// Невалидная (нет ни веса, ни обхвата) — документ без изменений (тот же объект).
export function putEntry(body, entry, now = new Date().toISOString()) {
  const e = normalizeEntry({ ...entry, at: now, del: false })
  if (!e) return body
  const b = normalizeBody(body)
  return compactBody({ ...b, entries: [e, ...b.entries.filter((x) => x.id !== e.id)] }, localYmd(now))
}

export function deleteEntry(body, id, now = new Date().toISOString()) {
  const b = normalizeBody(body)
  const cur = b.entries.find((x) => x.id === id && !x.del)
  if (!cur) return body
  return compactBody({
    ...b,
    entries: b.entries.map((x) => (x.id === id ? { id: x.id, date: x.date, at: now, del: true } : x)),
  }, localYmd(now))
}

// Настройки документа (goal / fields / hide) — с отметкой времени для LWW.
export function setBodyPrefs(body, patch, now = new Date().toISOString()) {
  const b = normalizeBody(body)
  const next = normalizeBody({ ...b, ...patch, at: now })
  return compactBody(next, localYmd(now))
}

// «Удалить мои данные»: все записи — надгробиями (иначе второе устройство вернуло
// бы их слиянием), цель снята. Выбор обхватов и «Скрыть цифры» — настройки, остаются.
export function clearBody(body, now = new Date().toISOString()) {
  const b = normalizeBody(body)
  if (!b.entries.some((e) => !e.del) && !b.goal) return body
  return {
    ...b,
    entries: b.entries.map((e) => (e.del ? e : { id: e.id, date: e.date, at: now, del: true })),
    goal: null,
    at: now,
  }
}

// ----------------------------- ряды и тренд ---------------------------------

// Взвешивания по дням (от старых к новым): несколько записей за день — среднее.
export function weightDays(body) {
  const sum = new Map()
  for (const e of liveEntries(body)) {
    if (e.weight == null) continue
    const s = sum.get(e.date) ?? { t: 0, n: 0 }
    s.t += e.weight
    s.n++
    sum.set(e.date, s)
  }
  return [...sum.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, s]) => ({ date, weight: round1(s.t / s.n) }))
}

// Тренд: на каждый день взвешивания — среднее за TREND_DAYS дней, включая этот.
// Соленое утро сдвигает тренд на десятые, а не на «+1.2 за месяц».
export function trendSeries(days) {
  const out = []
  for (let i = 0; i < days.length; i++) {
    const from = shiftYmd(days[i].date, -(TREND_DAYS - 1))
    let t = 0
    let n = 0
    for (let j = i; j >= 0 && days[j].date >= from; j--) { t += days[j].weight; n++ }
    out.push({ date: days[i].date, value: t / n })
  }
  return out
}

// Изменение тренда за ~30 дней: { delta, days } или null (истории меньше двух недель).
// База — последняя точка тренда не позже «последний день − 30»; если записей
// так далеко нет, но история не короче 14 дней — первая точка (и честное «за N дней»).
export function trendChange(trend, span = 30) {
  if (trend.length < 2) return null
  const last = trend[trend.length - 1]
  const edge = shiftYmd(last.date, -span)
  let base = null
  for (const p of trend) { if (p.date <= edge) base = p; else break }
  if (!base) {
    const first = trend[0]
    if (daysBetween(first.date, last.date) < 14) return null
    base = first
  }
  return { delta: round1(last.value - base.value), days: daysBetween(base.date, last.date) }
}

// Темп, кг в неделю: наклон прямой по точкам тренда за последние 28 дней.
// null — точек меньше трех или они укладываются в две недели (рано судить).
export function trendPace(trend, windowDays = 28) {
  if (trend.length < 3) return null
  const last = trend[trend.length - 1]
  const from = shiftYmd(last.date, -windowDays)
  const pts = trend.filter((p) => p.date >= from)
  if (pts.length < 3 || daysBetween(pts[0].date, last.date) < 14) return null
  const xs = pts.map((p) => daysBetween(pts[0].date, p.date))
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length
  const my = pts.reduce((s, p) => s + p.value, 0) / pts.length
  let num = 0
  let den = 0
  for (let i = 0; i < pts.length; i++) { num += (xs[i] - mx) * (pts[i].value - my); den += (xs[i] - mx) ** 2 }
  if (!den) return null
  return round1((num / den) * 7)
}

// ----------------------------- цель и тон -----------------------------------

// Тон числа (правило 2): 'good' — движение к СВОЕЙ цели человека, иначе 'neutral'.
// Другого тона нет: красного/желтого для веса нет нигде, без цели все нейтрально.
// delta — изменение (кг), value — текущий вес (нужен только для «держать»).
export function toneFor(delta, goal, value = null) {
  const g = normalizeGoal(goal)
  if (!g) return 'neutral'
  if (g.kind === 'keep') {
    return Number.isFinite(value) && Math.abs(value - g.target) <= KEEP_BAND ? 'good' : 'neutral'
  }
  if (!Number.isFinite(delta) || delta === 0) return 'neutral'
  if (g.kind === 'down') return delta < 0 ? 'good' : 'neutral'
  return delta > 0 ? 'good' : 'neutral'
}

// Проверка цели при вводе (fb_f87011ab, fb_1993296f): «набрать» — выше текущего веса, «сбросить» —
// ниже. null — все в порядке (или веса еще нет — сравнивать не с чем), иначе 'up' | 'down'.
export function goalTargetProblem(kind, target, current) {
  if (!Number.isFinite(target) || !Number.isFinite(current)) return null
  if (kind === 'up' && target <= current) return 'up'
  if (kind === 'down' && target >= current) return 'down'
  return null
}

// «Держать» — без выбора числа: держим текущий вес (по тренду), округленный до 0.5 кг.
export const keepTarget = (current) => (Number.isFinite(current) ? Math.round(current * 2) / 2 : null)

// Сколько до цели: { left, reached } или null (цели нет). reached у «держать» —
// попадание в коридор; у «сбросить/набрать» — цель пройдена.
export function goalLeft(goal, value) {
  const g = normalizeGoal(goal)
  if (!g || !Number.isFinite(value)) return null
  if (g.kind === 'keep') {
    const off = Math.abs(value - g.target)
    return { left: off <= KEEP_BAND ? 0 : round1(off - KEEP_BAND), reached: off <= KEEP_BAND }
  }
  const left = g.kind === 'down' ? value - g.target : g.target - value
  return { left: round1(Math.max(0, left)), reached: left <= 0 }
}

// Прогноз «≈ к дате» (правило 5): только когда темп ведет к цели и до нее не дальше
// года. Иначе null — без «темп не тот».
export function goalForecast(goal, value, pace, today = localYmd(new Date())) {
  const g = normalizeGoal(goal)
  if (!g || g.kind === 'keep' || !Number.isFinite(value) || !Number.isFinite(pace) || pace === 0) return null
  const left = g.kind === 'down' ? value - g.target : g.target - value
  if (left <= 0) return null
  const toward = g.kind === 'down' ? pace < 0 : pace > 0
  if (!toward) return null
  const days = Math.ceil((left / Math.abs(pace)) * 7)
  if (days > 365) return null
  return shiftYmd(today, days)
}

// ----------------------------- связки ---------------------------------------

// «Вес на дату» для этапа 2 (нагрузка подтягиваний, гравитрон): последний вес НЕ позже
// дня; старше WEIGHT_FRESH_DAYS — null (связка молча не показывается, без «обнови вес»).
export function bodyWeightOn(body, ymd) {
  for (const e of liveEntries(body)) { // свежие сверху
    if (e.weight == null || e.date > ymd) continue
    return daysBetween(e.date, ymd) <= WEIGHT_FRESH_DAYS ? e.weight : null
  }
  return null
}

// Последняя запись (с весом или обхватами) — для «Последняя запись · 27 октября».
export const lastEntry = (body) => liveEntries(body)[0] ?? null
export const lastWeighIn = (body) => liveEntries(body).find((e) => e.weight != null) ?? null

// Последние значения обхватов: { waist: { value, date, delta, days } }. delta — к
// самому раннему замеру в пределах ~2 месяцев (без цвета: у каждого свое «хорошо»).
export function lastMeasures(body) {
  const list = liveEntries(body)
  const out = {}
  for (const f of FIELD_IDS) {
    const withF = list.filter((e) => e[f] != null)
    if (!withF.length) continue
    const cur = withF[0]
    const edge = shiftYmd(cur.date, -62)
    const older = withF.filter((e) => e.date < cur.date && e.date >= edge)
    const base = older[older.length - 1] ?? null
    out[f] = {
      value: cur[f],
      date: cur.date,
      delta: base ? round1(cur[f] - base[f]) : null,
      days: base ? daysBetween(base.date, cur.date) : null,
    }
  }
  return out
}

// ----------------------------- подписи --------------------------------------

// «27 октября»; не этот год — «27 октября 2025».
export function fmtBodyDate(ymd, today = localYmd(new Date())) {
  const d = toDate(ymd)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = String(ymd).slice(0, 4) === String(today).slice(0, 4)
  const opts = sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' }
  return d.toLocaleDateString('ru-RU', opts).replace(/\s?г\.$/, '')
}

// Изменение со знаком и настоящим минусом: −1.8 / +0.4 / 0.
export function fmtSigned(v) {
  const r = Number.isFinite(v) ? round1(v) : 0
  if (r === 0) return '0'
  return (r < 0 ? '−' : '+') + String(Math.abs(r))
}

// Подпись строки в Профиле (правило 8): дата, а не вес — цифра не висит на виду.
// Без записей — спокойное «по желанию», а не призыв.
export function bodyRowSubtitle(body, today = localYmd(new Date())) {
  const e = body ? lastEntry(body) : null
  return e ? `последняя запись ${fmtBodyDate(e.date, today)}` : 'по желанию · видно только тебе'
}
