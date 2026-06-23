# Пошаговая настройка: Supabase + GitHub

Инструкция для ручных шагов под твоей учётной записью (код генерируется отдельно). Делается один раз, занимает ~20–30 минут. Всё бесплатно.

> Актуально на июнь 2026. Supabase перешёл с ключей `anon` / `service_role` на **publishable** / **secret**. Старые ключи отключат к концу 2026 — поэтому ниже используем новые.

---

## Часть 1. Supabase (база данных)

### 1.1. Регистрация и проект
1. Открой https://supabase.com → **Start your project** → войди через GitHub (удобно — один аккаунт на всё).
2. На дашборде нажми **New project**.
3. Заполни:
   - **Name:** `gym-tracker` (любое).
   - **Database Password:** придумай надёжный пароль и **сохрани его** (понадобится редко, но восстановить нельзя).
   - **Region:** ближайший к вам (например, Frankfurt / EU Central).
   - Plan — **Free**.
4. Нажми **Create new project** и подожди 1–2 минуты, пока БД поднимется.

### 1.2. Скопировать ключи подключения
1. В проекте слева внизу: **Project Settings** (шестерёнка) → **API Keys**.
2. Если раздела с ключами нет — нажми **Create new API keys**.
3. Скопируй и сохрани два значения (вставим в код позже):
   - **Project URL** — вид `https://xxxxxxxx.supabase.co`.
   - **Publishable key** — начинается с `sb_publishable_...`. Это публичный ключ для клиента (браузер/телефон), у него низкие права — безопасно класть в код.
4. **Secret key** (`sb_secret_...`) — НЕ нужен для приложения и НЕ должен попадать в код. Игнорируй его.

> Где взять `Project URL`, если не нашёл: тот же раздел **API Keys** или **Project Settings → Data API**.

### 1.3. Создать таблицы
1. Слева → **SQL Editor** → **New query**.
2. Когда я пришлю файл `supabase/schema.sql`, вставь его содержимое сюда и нажми **Run**. Создадутся таблицы и политики доступа (RLS).
3. Затем так же выполни `supabase/seed.sql` — загрузится стартовый справочник упражнений.

> Пока кода нет — просто запомни, что таблицы создаются здесь, вставкой SQL и кнопкой Run.

---

## Часть 2. GitHub (репозиторий + хостинг)

### 2.1. Создать репозиторий
1. Открой https://github.com → **New repository** (плюс справа вверху → New repository).
2. Заполни:
   - **Repository name:** `gym-tracker`.
   - **Visibility:** Public (для бесплатного GitHub Pages проще — публичный). Если нужен приватный — Pages на приватных репо тоже работает на бесплатном плане, но публичный надёжнее.
   - Галочки **Add README** и т.п. можно не ставить — код зальём готовый.
3. **Create repository**.

### 2.2. Залить код
Когда пришлю готовый скаффолд, два пути:
- **Через сайт:** на странице репозитория → **Add file → Upload files** → перетащить файлы → **Commit**.
- **Через консоль** (если стоит git):
  ```
  git init
  git add .
  git commit -m "init"
  git branch -M main
  git remote add origin https://github.com/<твой-логин>/gym-tracker.git
  git push -u origin main
  ```

### 2.3. Добавить ключи Supabase в секреты
Чтобы ключи не лежали открыто в коде, сборка берёт их из секретов репозитория.
1. В репозитории: **Settings** → слева **Secrets and variables** → **Actions**.
2. **New repository secret**, добавь по очереди:
   - Имя `VITE_SUPABASE_URL`, значение — твой Project URL.
   - Имя `VITE_SUPABASE_KEY`, значение — твой `sb_publishable_...` ключ.

> Точные имена секретов я укажу в коде; если будут другими — подставь те, что в `deploy.yml`.

### 2.4. Включить GitHub Pages
1. В репозитории: **Settings** → слева **Pages**.
2. **Build and deployment → Source** → выбери **GitHub Actions** (НЕ «Deploy from a branch»).
3. Сохранять отдельно не нужно — выбор применяется сразу.

### 2.5. Первый деплой
1. В коде уже будет workflow `.github/workflows/deploy.yml` — он собирает приложение и публикует на Pages при каждом пуше в `main`.
2. После заливки кода открой вкладку **Actions** — увидишь запущенную сборку. Зелёная галочка = успех.
3. Адрес сайта появится в **Settings → Pages**, вид: `https://<твой-логин>.github.io/gym-tracker/`.
4. Открой его на телефоне → меню браузера → **Добавить на главный экран**: приложение встанет иконкой как нативное (PWA).

> Важно: в `vite.config.js` должен быть прописан `base: '/gym-tracker/'` (имя репозитория) — иначе на Pages не подгрузятся стили/скрипты. Это я учту в коде; если переименуешь репозиторий — поправь это значение.

---

## Итоговый чек-лист перед стартом разработки
- [ ] Проект Supabase создан.
- [ ] Сохранены **Project URL** и **publishable key**.
- [ ] Репозиторий GitHub `gym-tracker` создан.
- [ ] В Secrets добавлены `VITE_SUPABASE_URL` и `VITE_SUPABASE_KEY`.
- [ ] В Pages выбран источник **GitHub Actions**.

Когда эти пять пунктов готовы — присылай URL и можно генерировать и заливать код.

---

### Источники
- [Supabase — Understanding API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase — Migrating to publishable and secret API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Vite — Deploying a Static Site (GitHub Pages)](https://vite.dev/guide/static-deploy)
