# Журнал тренировок (kachalka-app)

PWA для учёта силовых тренировок небольшой группой друзей.
Стек: React + Vite + Supabase, хостинг на GitHub Pages. Подробное ТЗ — в `ТЗ.md` (Приложение C).

Это **первый проход MVP**: вход по PIN → запись тренировки → сохранение в Supabase → график максимума в жиме → деплой на Pages. Офлайн-режим, шаблоны, лидерборд, лента и админка — следующие проходы.

## Возможности (текущий проход)

- Вход по 4-значному PIN; список пользователей берётся из Supabase, PIN сверяется по хэшу SHA-256.
- Экран тренировки: добавление упражнения из справочника (поиск + фильтр по группе), подходы «вес × повторы» с крупными кнопками +/− и повтором предыдущего подхода.
- Прямая запись тренировки в Supabase (без офлайн-очереди — она в следующем проходе).
- График расчётного максимума «на раз» (1ПМ, формула Эпли) по жиму лёжа с отметкой рекордов.
- Оформление как PWA (манифест + service worker) и автодеплой на GitHub Pages.

## Локальный запуск

```bash
npm install
cp .env.example .env   # затем впиши Project URL и publishable-ключ Supabase
npm run dev
```

`.env` намеренно в `.gitignore` и в репозиторий не попадает — ключи хранятся только локально и в секретах GitHub.

## Настройка Supabase

1. Создай проект (см. `setup-supabase-github.md`).
2. SQL Editor → New query → выполни `supabase/schema.sql`, затем `supabase/seed.sql` (создаст таблицы, политики RLS и стартовый справочник упражнений).
3. Project URL и **publishable-ключ** (`sb_publishable_...`) пропиши в `.env` как `VITE_SUPABASE_URL` и `VITE_SUPABASE_KEY`.

Стартовый PIN у всех пользователей из `seed.sql` — **0000** (поменяй имена и PIN в сидах; смена PIN из интерфейса — следующий проход).

## Деплой на GitHub Pages

Репозиторий: `kachalka-app`. Имя зашито в `vite.config.js` → `base: '/kachalka-app/'`; переименуешь репозиторий — поправь там.

1. Settings → Secrets and variables → Actions → добавь секреты `VITE_SUPABASE_URL` и `VITE_SUPABASE_KEY`.
2. Settings → Pages → Source = **GitHub Actions**.
3. Любой пуш в `main` запускает сборку и публикацию (`.github/workflows/deploy.yml`). Сборка использует `npm ci`, поэтому в репозитории должен лежать `package-lock.json` (он закоммичен).
4. Адрес после успешной сборки: `https://myr4ge15.github.io/kachalka-app/`.

## Структура

```
src/
  components/ExercisePicker.jsx   выбор упражнения (поиск + фильтр)
  screens/   LoginScreen, WorkoutScreen, ProgressScreen
  db/        supabase.js          клиент Supabase
  lib/       oneRepMax.js (1ПМ), hash.js (SHA-256 PIN)
  App.jsx    сессия + вкладки
  main.jsx   точка входа
supabase/    schema.sql, seed.sql
public/      иконки PWA, favicon
.github/workflows/deploy.yml      сборка + деплой
```

## Заметки по безопасности

- **`.env` не коммитим.** В репозитории лежит только `.env.example` без значений.
- **Publishable-ключ — публичный по задумке.** Он попадает в собранный клиентский JS, доступ ограничивают политики RLS в Supabase, а не секретность ключа. Секретный ключ (`sb_secret_...`) в коде и репозитории быть не должен.
- **PIN.** Хэшируется SHA-256 без соли — для закрытого круга друзей приемлемо, но это не криптостойкая аутентификация. Усиление (соль, серверная проверка, полноценный Supabase Auth) — отдельный проход.
