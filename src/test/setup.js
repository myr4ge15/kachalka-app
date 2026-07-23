// Глобальный setup Vitest. Подключается ко ВСЕМ тестам (см. vite.config.js
// test.setupFiles), но реальную работу делает только в jsdom-окружении.
//
// Зачем guard `typeof window`: node-сьют чистого слоя (src/lib, src/db) DOM не
// имеет и в jest-dom не нуждается — там матчеры бесполезны, а лишний импорт мог
// бы задеть 55 уже зелёных файлов. Компонентные тесты (RTL) объявляют
// `// @vitest-environment jsdom` докблоком → тут появляется `window`, и мы:
//   • расширяем expect матчерами @testing-library/jest-dom (toBeInTheDocument…);
//   • регистрируем afterEach(cleanup) — размонтируем дерево между тестами, иначе
//     соседние рендеры внутри файла дают дубли в DOM и ложные совпадения.
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
  const { cleanup } = await import('@testing-library/react')
  const { afterEach } = await import('vitest')
  afterEach(() => cleanup())
}
