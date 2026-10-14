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

// «Сохранить» композера (с числом подходов в скобках).
export const saveButton = (page) => page.getByRole('button', { name: /^Сохранить( \(\d+\))?$/ })
