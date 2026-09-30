// Акцент интерфейса — редизайн «Спорт-блоки» (docs/plans/PLAN-redesign-sport-blocks.md).
//
// Фон у всех один («ночной»), акцент выбирает пользователь: 7 готовых цветов или
// «свой оттенок». Значения готовых акцентов живут в CSS (`html[data-accent="…"]` в
// src/index.css), здесь — только их список для экрана «Оформление». «Свой оттенок»
// считается из одного числа 0–359: светлота и насыщенность фиксированы, как у готовых,
// поэтому акцент всегда виден на ночном фоне, а темный текст на нем всегда читается.
//
// Выбор хранится на устройстве (localStorage), а не в персональной базе: сплэш и
// первый кадр рисуются ДО входа, когда пользователь еще не известен. Применение до
// загрузки делает public/accent-boot.js — он повторяет parseAccent/customTokens
// (модули там недоступны, CSP запрещает инлайн); совпадение проверяет тест.
//
// Чистый модуль: без React, Dexie и сети.

export const ACCENT_KEY = 'gym_app_accent'
export const DEFAULT_ACCENT = 'volt'
export const CUSTOM = 'custom'
export const DEFAULT_HUE = 200

export const ACCENTS = [
  { id: 'volt', name: 'Вольт', color: '#C8F135' },
  { id: 'teal', name: 'Бирюза', color: '#2DD4BF' },
  { id: 'red', name: 'Алый', color: '#FF4D5E' },
  { id: 'yellow', name: 'Желтый', color: '#FFD60A' },
  { id: 'pink', name: 'Фуксия', color: '#FF4FB0' },
  { id: 'violet', name: 'Фиолет', color: '#9B7BFF' },
  { id: 'peach', name: 'Персик', color: '#FFBE98' },
]

const PRESET_IDS = new Set(ACCENTS.map((a) => a.id))

// Переменные, которые «свой оттенок» задает инлайном на <html>. Для готовых
// акцентов их надо снимать, иначе инлайн перебьет значения из CSS.
export const CUSTOM_PROPS = ['--acc', '--acc-2', '--on-acc', '--acc-soft']

export function normHue(h) {
  const n = Math.round(Number(h))
  if (!Number.isFinite(n)) return DEFAULT_HUE
  return ((n % 360) + 360) % 360
}

// Красная зона — оттенок похож на цвет ошибок и спада на графиках. Не запрещаем,
// только предупреждаем.
export function isRedZone(h) {
  const x = normHue(h)
  return x <= 35 || x >= 335
}

export function customTokens(h) {
  const H = normHue(h)
  return {
    '--acc': `oklch(0.79 0.19 ${H})`,
    '--acc-2': `oklch(0.87 0.11 ${H})`,
    '--on-acc': `oklch(0.2 0.04 ${H})`,
    '--acc-soft': `oklch(0.79 0.19 ${H} / 0.15)`,
  }
}

// Строка из localStorage → { id, hue }. Любой мусор → акцент по умолчанию.
export function parseAccent(raw) {
  const fallback = { id: DEFAULT_ACCENT, hue: DEFAULT_HUE }
  if (typeof raw !== 'string' || !raw) return fallback
  let v
  try { v = JSON.parse(raw) } catch { return fallback }
  if (!v || typeof v !== 'object') return fallback
  const hue = normHue(v.hue ?? DEFAULT_HUE)
  if (v.id === CUSTOM) return { id: CUSTOM, hue }
  if (PRESET_IDS.has(v.id)) return { id: v.id, hue }
  return { ...fallback, hue }
}

export function serializeAccent(pref) {
  const p = parseAccent(JSON.stringify(pref ?? {}))
  return JSON.stringify({ id: p.id, hue: p.hue })
}

// Применить к корню документа (в тестах — к любому элементу со style/dataset).
export function applyAccent(root, pref) {
  if (!root) return
  const p = parseAccent(JSON.stringify(pref ?? {}))
  root.dataset.accent = p.id
  if (p.id === CUSTOM) {
    const t = customTokens(p.hue)
    for (const k of CUSTOM_PROPS) root.style.setProperty(k, t[k])
  } else {
    for (const k of CUSTOM_PROPS) root.style.removeProperty(k)
  }
}

// Чей выбор лежит на устройстве (v6.2.4): поле `by` = id учетки, которая выбрала
// цвет в «Оформлении». localStorage один на устройство, а учеток на нем может быть
// несколько — без владельца цвет одной учетки утекал в другую (в v6.2.0 хук
// заливал «найденный на устройстве» выбор в учетку того, кто вошел следующим).
// null — выбор без владельца (дефолт, старые версии). Сплэш поле игнорирует.
export function loadAccentOwner(storage) {
  try {
    const v = JSON.parse(storage?.getItem(ACCENT_KEY) ?? 'null')
    return v && typeof v === 'object' && typeof v.by === 'string' ? v.by : null
  } catch { return null }
}

// Равны ли два выбора (для «свой» важен оттенок, для готового — только id).
export function sameAccent(a, b) {
  const x = parseAccent(JSON.stringify(a ?? {}))
  const y = parseAccent(JSON.stringify(b ?? {}))
  return x.id === y.id && (x.id !== CUSTOM || x.hue === y.hue)
}

export function loadAccent(storage) {
  try { return parseAccent(storage?.getItem(ACCENT_KEY) ?? '') } catch { return parseAccent('') }
}

// owner — id учетки, чей это выбор (см. loadAccentOwner); без него — «ничей».
export function saveAccent(storage, pref, owner = null) {
  try {
    const v = JSON.parse(serializeAccent(pref))
    if (owner) v.by = String(owner)
    storage?.setItem(ACCENT_KEY, JSON.stringify(v))
    return true
  } catch { return false }
}
