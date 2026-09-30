// Применяет выбранный акцент ДО отрисовки сплэша и приложения (редизайн «Спорт-блоки»).
// Обычный скрипт из <head>: CSP запрещает инлайн-скрипты, а модуль main.jsx грузится
// позже — без этого первый кадр мигал бы акцентом по умолчанию.
// Логика повторяет parseAccent/customTokens из src/lib/accent.js; совпадение
// проверяет src/lib/accent.test.js. Меняешь одно — меняй и другое.
/* global document, localStorage */
(function () {
  var root = document.documentElement
  var PRESETS = ['volt', 'teal', 'red', 'yellow', 'pink', 'violet', 'peach']
  var id = 'volt'
  var hue = 200
  try {
    var v = JSON.parse(localStorage.getItem('gym_app_accent') || 'null')
    if (v && typeof v === 'object') {
      var n = Math.round(Number(v.hue == null ? 200 : v.hue))
      hue = isFinite(n) ? ((n % 360) + 360) % 360 : 200
      if (v.id === 'custom' || PRESETS.indexOf(v.id) !== -1) id = v.id
    }
  } catch { /* нет хранилища или мусор — акцент по умолчанию */ }
  root.setAttribute('data-accent', id)
  if (id === 'custom') {
    root.style.setProperty('--acc', 'oklch(0.79 0.19 ' + hue + ')')
    root.style.setProperty('--acc-2', 'oklch(0.87 0.11 ' + hue + ')')
    root.style.setProperty('--on-acc', 'oklch(0.2 0.04 ' + hue + ')')
    root.style.setProperty('--acc-soft', 'oklch(0.79 0.19 ' + hue + ' / 0.15)')
  }
})()
