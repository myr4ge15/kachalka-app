// ============================================================================
// ESLint (flat config) — статический анализ клиентского кода.
//
// Смысл слайса: главный дефект качества был не в коде, а в процессе — CI гонял
// только тесты + smoke-сборку, поэтому `react-hooks/rules-of-hooks` (условный
// вызов хука), «мёртвые» переменные и опечатки в глобалах никто не ловил.
//
// Политика строгости осознанно мягкая, чтобы включение линта не потребовало
// разгребать весь код разом (это делается постепенно):
//   • ЖЁСТКАЯ ошибка (роняет CI) — только `react-hooks/rules-of-hooks`
//     (нарушение = реальный баг) плюс базовые правила `@eslint/js` (синтаксис,
//     `no-undef` при верно заданных глобалах);
//   • `exhaustive-deps` и `no-unused-vars` — `warn`: видны в выводе, но не рвут
//     сборку. Потолок строгости можно поднимать по мере чистки дерева.
//
// Компоненты, используемые ТОЛЬКО в JSX, базовый `no-unused-vars` считает
// неиспользуемыми (без тяжёлого eslint-plugin-react). Снимаем это, как в
// scaffold'е Vite, паттерном `^[A-Z_]` — имена с заглавной (компоненты) и
// констант-стайл в varsIgnorePattern не трогаем.
// ============================================================================
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'coverage/**'] },

  js.configs.recommended,

  // Клиентский код приложения (браузер + Vite define __APP_VERSION__).
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Единственная жёсткая ошибка из плагина: условный/циклический вызов хука —
      // это реальный баг, а не стилистика.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': [
        'warn',
        { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Тесты (Vitest) гоняются в node-окружении; сам API импортируется явно из
  // 'vitest', поэтому нужны только node-глобалы поверх браузерных из блока выше.
  {
    files: ['src/**/*.test.js'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Конфиги/скрипты в корне (vite.config.js, этот файл) — node-окружение.
  {
    files: ['*.{js,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
]
