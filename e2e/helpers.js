// Общие шаги e2e. Элементы ищем по роли и подписи, а не по классам (DoD п. 2):
// разметка меняется с редизайном, подписи — нет.

// PIN на экранной клавиатуре входа: кнопки с цифрой.
export async function enterPin(page, pin) {
  for (const digit of pin) await page.getByRole('button', { name: digit, exact: true }).click()
}

// Нижнее меню (на десктопе — боковая колонка): <nav aria-label="Разделы">.
export const tabbar = (page) => page.getByRole('navigation', { name: 'Разделы' })

export async function openTab(page, name) {
  await tabbar(page).getByRole('button', { name, exact: true }).click()
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Строка пикера упражнений: имя упражнения + подпись группы.
export const pickerItem = (page, name) => page.getByRole('button', { name: new RegExp(`^${esc(name)}`) })

// Геометрия кнопок на текущем экране (аудит 16.10, 🟡-1): кнопка не выходит за край экрана,
// кнопки .btn одного ряда (общий родитель, одинаковый верх) — одной высоты. Горизонтальные
// ленты (чипы дисциплин и т. п.) и скрытые слои стека экранов не проверяются. Пустой массив — ок.
export function layoutProblems(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const scrollsX = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX
        if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true
      }
      return false
    }
    const visible = (el) => {
      if (el.closest('[inert],[aria-hidden="true"],[hidden]')) return false
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width >= 1 && r.height >= 1 && cs.visibility !== 'hidden' && cs.display !== 'none'
    }
    const label = (el) => `«${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}» .${[...el.classList].join('.')}`
    const buttons = [...document.querySelectorAll('button, a.btn, [role="button"]')].filter(visible)
    const bad = []
    for (const b of buttons) {
      const r = b.getBoundingClientRect()
      if ((r.left < -1 || r.right > vw + 1) && !scrollsX(b)) bad.push(`за краем экрана: ${label(b)} [${Math.round(r.left)}…${Math.round(r.right)}]`)
    }
    const rows = new Map()
    for (const b of buttons.filter((x) => x.classList.contains('btn'))) {
      const list = rows.get(b.parentElement) ?? []
      list.push([b, b.getBoundingClientRect()])
      rows.set(b.parentElement, list)
    }
    for (const list of rows.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const [a, ra] = list[i]
          const [c, rc] = list[j]
          if (Math.abs(ra.top - rc.top) <= 2 && Math.abs(ra.height - rc.height) > 1) {
            bad.push(`разная высота в ряду: ${label(a)} ${Math.round(ra.height)} ≠ ${label(c)} ${Math.round(rc.height)}`)
          }
        }
      }
    }
    return bad
  })
}

// «Сохранить» композера (с числом подходов в скобках).
export const saveButton = (page) => page.getByRole('button', { name: /^Сохранить( \(\d+\))?$/ })

// Сеть по требованию (покрытие тестами 19.10.2026): navigator.onLine читает флаг страницы.
// По умолчанию офлайн, как в остальных спеках; setOnline(page, true) включает сеть до
// следующей загрузки страницы (флаг живет в window и после перезагрузки снова false).
export async function switchableOnline(context) {
  await context.addInitScript(() => {
    Object.defineProperty(window.navigator, 'onLine', { get: () => window.__e2eOnline === true, configurable: true })
  })
}
export async function setOnline(page, on, { fire = true } = {}) {
  await page.evaluate(([v, f]) => {
    window.__e2eOnline = v
    if (f) window.dispatchEvent(new Event(v ? 'online' : 'offline'))
  }, [on, fire])
}

// Сид устройства «уже входило» + офлайн-вход по PIN (как в smoke.spec.js). Возвращает учетку.
export async function seedAndLogin(page, app = '/kachalka-app/') {
  await page.goto(app)
  const user = await page.evaluate(async () => (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E())
  await page.reload()
  await page.getByRole('button', { name: user.name }).click()
  await enterPin(page, user.pin)
  await tabbar(page).waitFor()
  return user
}

// Ответ Supabase с CORS (страница на 127.0.0.1, бэкенд — e2e-offline.supabase.co).
export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'access-control-expose-headers': '*',
}
export function fulfillJson(route, json, status = 200) {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: CORS })
  return route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(json) })
}
