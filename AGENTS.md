# AGENTS.md — рабочая память проекта (читать в начале каждой задачи)

Проект: **Журнал тренировок (kachalka-app)** — PWA для закрытого круга друзей (зал, прогресс
в силовых, лёгкое соревнование). Стек: **React 19 + Vite 8**, локальная база **Dexie
(IndexedDB, схема v7)**, бэкенд **Supabase**, тесты **Vitest (+ RTL для компонентов)**.
Актуальная версия — в `package.json` (источник правды, прокидывается в UI как `__APP_VERSION__`).

Здесь — только рабочие правила: инварианты, красные линии, особенности среды, Definition of Done.
Подробные описания подсистем с историей решений — в `docs/PASPORT.md`
(раздел «Архитектурная история подсистем»). Задачи — в `docs/BACKLOG.md`.

> 📁 **Раскладка рабочих доков (закрытые, git-ignored):** `docs/` — `PASPORT.md`, `BACKLOG.md`,
> `CHANGELOG-dev.md`; `docs/plans/` — `PLAN-*.md`; `docs/reviews/` — ревью и предложения;
> `docs/guides/` — `приватный-репо.md`; `docs/log/` — архив «Лога проходов» по месяцам и
> `анонсы-телеграм.md` (архив анонсов до v6.3.8). Публичны в `docs/` только `quick-start.md` и
> `screenshots/` — `.gitignore` скрывает `docs/*` целиком (v6.16.0), новый док туда класть смело;
> `prototypes/` — мокапы (`*.html`); `archive/` — `ТЗ.md`; `supabase/` — серверная часть.
> Точный состав отслеживаемых файлов определяют `git status` и `.gitignore`; не поддерживать здесь
> вручную закрытый список каталогов. `AGENTS.md` хранится в git как общая рабочая память проекта.
> В чистом клоне локальных `docs/`/`supabase/` может не быть — это не повод выдумывать их содержимое.
>
> ⚠️ **Ещё коварнее, чем отсутствующая папка, — папка УСТАРЕВШАЯ.** `docs/` и `supabase/` живут в
> отдельном репозитории (`kachalka-private`), и в рабочей папке легко оказывается старый снимок,
> которому по инерции веришь. Проверено 15.08.2026: локальный `telegram.sql` отставал на целый
> контракт (был без `metric`/`value` и без фильтра приватности), а `roster-contract.sql` вовсе
> отсутствовал. **Источник правды по СЕРВЕРУ — сама база, а не файл.** Перед правкой любой функции
> снимать её тело: `select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on
> n.oid = p.pronamespace where n.nspname='public' and p.proname='<имя>';` — и собирать `create or
> replace` поверх него. Иначе Postgres в лучшем случае откажет («cannot change return type»), в
> худшем — молча откатит функцию к старому поведению.

> 🤝 **Проект ведётся двумя агентами: Codex (этот файл) и Claude Code / Cowork (`CLAUDE.md`).**
> `CLAUDE.md` — тонкая надстройка: указатель на `AGENTS.md` плюс специфика Claude (Linux-песочница
> bash, пути, skills). **Инварианты, серверные каноны и рабочие правила меняются ТОЛЬКО здесь** —
> дублировать их в `CLAUDE.md` не нужно, иначе файлы разъедутся.

---

## Архитектурные инварианты (нарушать — только осознанно и с записью в лог)

- **Источник правды для UI — локальная база (Dexie).** Экраны не обращаются к таблицам Dexie
  напрямую: чтение/запись идут через модули `src/db/` (на `useLiveQuery`). Основной CRUD — в
  `src/db/repo.js`; специализированные подсистемы используют свои DB-модули (`notifications.js`,
  `insights.js`, `badges.js` и т.д.). Сетевые мутации из экранов запрещены; сеть в `repo.js` не
  трогаем.
  - **Единственное исключение — «слой витрин» (read-only):** `db/feed.js` (`fetchFeed`) и
    `db/leaderboard.js` (`fetchLeaderboard`) делают прямые read-only `supabase`-запросы под RLS и
    кэшируют результат в Dexie. **Мутации — исключительно через очереди в `sync.js`.**
- **База персональная, а не одна на браузер:** `gym_app_${userId}` у каждого + общая «загрузочная»
  `gym_app_login` (ростер учёток для пикера входа + офлайн-кэш PIN-хэшей, читается ДО выбора юзера).
  В `src/db/local.js`: `db` — активный инстанс (live binding, `null` до входа), `loginDb` — общая;
  `openUserDb`/`closeUserDb` сериализованы (`lib/serialQueue.js`). Старую общую `gym_app` НЕ удаляем
  (там могут лежать неперенесённые правки других учёток устройства).
- **Схема Dexie — v7.** Правило по умолчанию: **схему и синхронизацию НЕ менять**, если задача этого
  прямо не требует; большинство задач решается на клиенте из уже денормализованных `entries`.
  Неиндексируемое поле можно добавить без бампа схемы (так живут `metric`, `submuscle`,
  `_base_updated_at`).
- **Синхронизация:** `src/db/sync.js` — только оркестрация (состояние, `syncNow`, `startSync`,
  Realtime, поллинг, `useSyncStatus`); стадии — в `src/db/sync/pull.js` и `src/db/sync/push.js`.
  - **Порядок очередей важен из-за FK:** `ex_outbox` (упражнения) и `tpl_outbox` (шаблоны) уходят
    РАНЬШЕ `outbox` (тренировки); `reaction_outbox` — ПОСЛЕ тренировок. Upsert'ы идемпотентны
    (клиентский UUID).
  - **Pull инкрементальный** — по серверному watermark `updated_at` (метки `wm_*`/`sig_*` в `meta`,
    хелперы `lib/pullWatermark.js`); удаления тренировок ловятся отдельной сверкой `select id`
    (`lib/pullReconcile.js`). Подтяжки идут параллельно (`Promise.all`); reject по тренировкам
    критичен (`netError`), сбой прочих деградирует мягко.
  - **Правка во время сетевого запроса не должна теряться** (v5.15.1): push снимает `_dirty` и
    удаляет операцию ТОЛЬКО если документ не менялся, пока шёл запрос (тренировки/шаблоны — по
    `updated_at`, упражнения — по снимку отправленных полей); цели и `user_meta_state` коммитятся
    по СВЕЖЕМУ состоянию в `d.transaction('rw', d.meta)`, а не по снимку со входа; pull
    перепроверяет локальное после сетевого ответа (`pullGoal`, `pullUserMeta`). Новые стадии
    синка писать по тому же образцу — снимок до `await` + запись снимка = тихая потеря правки.
  - **Синк идёт только под сессией ЭТОЙ учётки:** `hasSession(userId)` сверяет claim
    `app_metadata.app_user_id`; чужая сессия (общий телефон, офлайн-анлок) = «нет сессии».
  - **Пустой ответ под RLS — не «удалено» (v6.7.5).** Отозванная сессия (`session_epoch` вырос, токен ещё жив)
    даёт `app_uid() = NULL` и пустые выборки БЕЗ ошибки. Поэтому `syncNow` перед прогоном сверяет личность
    (`supabase.serverIdentity` → `rpc('app_uid')`) и при несовпадении гасит сессию, а `pullWorkouts` без
    подтверждённой личности не удаляет по пустому списку id. Новая стадия pull, удаляющая локальное по
    отсутствию на сервере, обязана учитывать то же. Тренировку, которая есть на сервере, но не локально,
    pull дотягивает по id (самолечение) — на это опирается `discardDeadLetter`.
  - **Dead-letter — только за ошибки данных (v6.7.5).** Сеть, таймаут, 5xx, протухший JWT попыткой не
    считаются (`lib/syncErrors.js`); новая правка документа воскрешает его мёртвую операцию. Гард `running`
    в `syncNow` ставится синхронно, до первого `await`. Без сессии `syncNow` сам зовёт
    `refreshSessionSilently` (PIN в памяти привязан к учётке; не чаще раза в минуту).
  - **`user_meta`: базис серверной версии (v6.7.5).** `user_meta_state.<kind>.base` — последний виденный
    серверный `updated_at` (pull/push). Если сервер с базиса не менялся, локальная dirty-правка побеждает
    без сравнения часов; LWW по времени — только когда сервер изменился после базиса.
  - **Пуши на общем телефоне (v6.7.5, v6.7.7):** владелец подписки браузера — `localStorage
    gym_app_push_owner`; при входе `reconcilePushOwner` снимает ЧУЖУЮ подписку и заново привязывает свою.
    Выход из учетки подписку в браузере НЕ снимает — только отвязывает на сервере (`push_unsubscribe`):
    iOS без нажатия пользователя может не дать подписаться заново, и в 6.7.5–6.7.6 уведомления после
    выхода/входа молча выключались. Снимать подписку в браузере — только тумблером «выкл» и при входе
    другой учетки. Новый путь включения пушей обязан ставить владельца (`enablePush` делает это сам).
  - **Что запишется — считает одно правило:** `lib/setLimits.js` `savableSet` используют и `repo.cleanEntries`,
    и счётчик на «Сохранить» (`workoutEntries.countSavable`). День тренировки для группировок — всегда
    локальный (`calendar.localYmd`), не срез ISO-строки.
  - **Realtime — только СИГНАЛ** «что-то изменилось», данные всё равно тянет обычный `pull` под RLS.
    Поллинг адаптивный (канал жив → 60 c, иначе 20 c) + экспоненциальный backoff до 5 мин
    (`lib/realtimeSync.js`, `lib/backoff.js`). Офлайн-модель (очереди) от Realtime не зависит.
- **Merge-часы тренировок:** базис правки `_base_updated_at` + чистый `lib/mergeClock.js`
  (`take-server`/`keep-local`/`conflict`). При конфликте выживает более поздняя по `updated_at`
  версия, проигравшая логируется в `meta.merge_conflicts` (последние 50) и в `lastError` синка —
  тихая потеря данных должна оставаться ВИДИМОЙ.
- **Документ тренировки денормализован:**
  `{ id, user_id, performed_at, created_at, updated_at, _base_updated_at, _dirty, _deleted,
     entries: [ { exercise_id, exercise:{id,name,muscle_group,submuscle,secondary,metric,is_bench_lift}, sets:[{weight,reps}] } ] }`
- **Метрики упражнения** (`exercises.metric`): `weight` (вес × повторы), `reps` (свой вес — повторы,
  `weight:0`), `time` (секунды лежат в `reps`, ввод мм:сс). Подход в БД всегда `{weight,reps}`.
  **Рекорд = лучший ЕДИНИЧНЫЙ подход** по ведущей метрике (`lib/metric.js` `leadingValue`);
  расчётный 1ПМ (Эпли, `lib/oneRepMax.js`) — вторично, сноской. Для упражнений без веса считаем
  повторы, а не 1ПМ.
- **Мышцы — двухуровневая модель:** крупная `muscle_group` (major, сохраняем для совместимости и
  женского лидерборда) + `submuscle` (primary) + `secondary[]`. Таксономия — `src/lib/muscles.js`,
  он НЕ импортит ничего из проекта (иначе цикл с `freshness.js`). Везде фолбэк на major при пустой
  подмышце. Вторичная нагрузка НЕ сбрасывает таймер восстановления.
- **Вход и доступ:** PIN проверяется НЕ на клиенте, а в Edge Function `auth-login` (service role),
  она мостит к скрытой учётке Supabase Auth и выдаёт настоящую сессию. RLS-идентичность —
  `app_uid()` из claim `app_metadata.app_user_id` + сверка `session_epoch` на каждый запрос
  (kill switch сессий). Офлайн-анлок сверяет PIN с локально кэшированным хэшем (`lib/hash.js`,
  constant-time) — **только когда сервер недоступен** (v6.14.0): онлайн экран входа сначала ждет
  `auth-login` (8 с), кэш — запасной путь при сети/таймауте/5xx; «неверный PIN» и «лок» сервера кэшем
  не обходятся (иначе старый PIN пускает после сброса/смены). Новый PIN — не из слабых (с П4 — только ~10
  самых частых): `lib/pinPolicy.js` ↔ `_shared/pin.ts` `isWeakPin` (одинаковые списки в тестах); новый путь
  задания PIN обязан проверять на сервере. Админка с 2FA — сессия `aal2` (см. «2FA админки»). Видимость чужих данных — серверная `can_see_user()` (приватность + связи
  «избранного круга»); гейт админки — серверный `is_admin()`.
- **Чистая логика — в `src/lib/`** (без Dexie/React/сети), покрывается тестами; DB-обвязка — в
  `src/db/`; презентационные куски экранов — в `src/components/` (props-driven, состояние остаётся
  в экране). **Секции крупных экранов** (v6.14.1) — в `src/components/<экран>/` (`admin/`, `profile/`):
  самостоятельный блок со СВОИМ состоянием и обработчиками (форма, подтверждение, онлайн-операция),
  экран только раскладывает их и держит общее (данные из `useLiveQuery`, навигацию). Новый такой блок
  кладем туда же, а не дописываем в экран; гард `setState` после ухода — `hooks/useAliveRef.js`.
  Жизненный цикл сессии — `hooks/useSession.js` (порядок «база → setUser», «user=null → closeUserDb»),
  стартовые листы — `hooks/useLaunchSheets.js`, навигация (вкладка, стек, интенты экранов, пуш) —
  `hooks/useAppNav.js`; поведение держат `App.nav.test.jsx` и `hooks/useAppNav.test.jsx`.
  Полная карта файлов — в `PASPORT.md`.
- **Дизайн — «Спорт-блоки» (v6.0.x, `docs/plans/PLAN-redesign-sport-blocks.md`; до него — «Aurora Glass»
  5.0.x):** компоненты не хардкодят цвета в JSX/inline-style; палитра и радиусы — токены `:root` в
  `src/index.css`. Старые имена (`--bg/--surface/--surface-2/--border/--text/--muted/--g1..g4/--glass/
  --stroke/--green/--red/--yellow`) СОХРАНЕНЫ и перенаправлены на «ночную» палитру; `--g1`/`--g3`/
  `--btn-g*` = акцент. **Акцент выбирает пользователь** («Профиль → Оформление»): `--acc`, `--acc-2`
  (светлый — ссылки), `--on-acc` (текст ПОВЕРХ акцента — всегда тёмный, белый на вольте/жёлтом/персике
  нечитаем), `--acc-soft` (подложка). Готовые акценты — `html[data-accent="…"]` в `index.css`, «свой
  оттенок» — инлайн-переменными на `<html>` из `lib/accent.js`. Применение ДО отрисовки —
  `public/accent-boot.js` (CSP запрещает инлайн-скрипты), логика дублирует `parseAccent`/`customTokens`,
  совпадение держит `accent.test.js`. **Смысловые цвета не акцент:** `--green` (успех/рост), `--red`,
  `--yellow`, `--g4` (рекорды), `--fr-*`, `--mm-*`. Любой элемент с фоном-акцентом красит текст в
  `var(--on-acc)`; полупрозрачный акцент — `color-mix(in srgb, var(--acc) N%, transparent)`.
  Шрифты: Onest (текст) + Sofia Sans Condensed 800/900 (`--font-display`: цифры и заголовки экранов),
  оба самохостинг. `backdrop-filter` — только на липких слоях, НЕ на карточках длинных списков
  (перф). Уважать `prefers-reduced-motion`.
  **Цифры Onest (v6.14.2):** в моноширинных цифрах (`tabular-nums`) «1» стоит в широкой клетке («1ПМ 1 3 3»),
  а двоеточие сидит на высоте строчных («5:27»). Поэтому на `body` — `lining-nums proportional-nums` и
  `font-feature-settings: "case" 1` (у Onest «case» меняет только `-:–—·`), кнопки и поля наследуют.
  `tabular-nums` локально НЕ включать для Onest; допустим только на `--font-display` (там «1» ровная).
  - **Пользовательское раскрытие не должно теряться после изменения высоты:** раскрытая карточка,
    строка аккордеона или явно выбранный элемент после React-commit центрируется в ближайшем
    скроллере через общий `hooks/useRevealFocus.js` (`block:'center'`; при `reduced-motion` —
    мгновенно). Начальная загрузка и закрытие экран не прокручивают.
    **Reveal — только на ФАКТИЧЕСКУЮ смену раскрытого элемента** (v5.12.2): активный элемент часто
    выбирается автоматически (фокус-режим композера), и заявка «раскрой уже раскрытое» — обычный тап
    по инпуту/кнопке внутри карточки. Центрирование в этот момент уводит экран ПОД ПАЛЬЦЕМ, а
    следующий тап попадает в съехавшую соседнюю строку. Решение по фокусу фиксируем, `revision`
    (триггер reveal) поднимаем только при переходе на другой элемент — `lib/workoutFocus.js`
    `nextFocusRequest`.
  - **Плавающие оверлеи — ПЛОТНАЯ подложка, а не стекло** (v5.6.1–5.6.2): в Aurora `--surface`/`--surface-2`/
    `--glass` были полупрозрачны, и слой поверх произвольного контента (плашка обновления, тост,
    липкие бары) над карточкой сливается с ней. Плотная подложка оверлеев — токен
    `--surface-solid` (`rgba(17,24,39,.94)`, v6); в Aurora это был хардкод `rgba(20,16,40,.94)`.
- **Навигация (`App.jsx`):** 4 вкладки — `home` (дефолт) / `history` / `feed` / `progress`; плюс
  вложенные ленивые роуты `notif`/`profile`/`admin`/`freshness`/`myex`/`achievements`/`appearance`
  (в таббар не выносятся); «назад» на всех вложенных экранах — общая круглая `components/BackButton.jsx`; с v6.8.1 тот же «назад» — свайпом от левого края (`hooks/useEdgeSwipeBack.js`, только iOS «на экране Домой»), а вложенные экраны въезжают сдвигом без fade. **Новый вложенный роут — в `NESTED_ROUTES` (`lib/screenNav.js`) и в `nestedBack()` (`hooks/useAppNav.js`, с v6.14.1; до того — `App.jsx`)**, плюс случай в `App.nav.test.jsx`, иначе ни свайпа, ни сдвига. Экран сдвигается `left`, НЕ transform (см. `.screen-anim` в `index.css`). **Позицию `.content` при смене экрана ставить только `lib/scrollBox.js` `settleScroll`** (v6.15.0), не голым `scrollTo`: на iPhone он игнорируется во время инерции — экран открывается внизу или пустым до тапа. Кнопка «+» (новая тренировка) с v6.0.1 — круг ПО ЦЕНТРУ таббара
  (`AddFab`), есть ВСЕГДА, включая вложенные роуты (v6.0.4); при занятом хабе (композер/экспорт) — утоплена и
  неактивна, состояние — чистая `lib/quickAdd.js` `fabState`; на десктопе скрыта, вместо неё —
  «+ Новая тренировка» в боковой колонке (`.side-new`, v6.2.3, то же состояние `fabState`). Точка активной вкладки — ОДНА общая `.tab-dot`, переезжает
  под нажатую вкладку (`hooks/useTabDot.js` пишет `--dot-x`); свою точку на `.tab.active` не рисовать. **`WorkoutScreen` своей вкладки НЕ имеет** — он смонтирован внутри `HistoryScreen`
  (`selected === 'new' | <id>`; на десктопе — master-detail). Скроллится `.content`, не окно.

## Что лежит ТОЛЬКО локально (частая причина «данные пропали»)

**Стек экранов (v6.8.5):** `App` сохраняет смонтированных предков вложенного роута
(`initialScreenStack` / `nextScreenStack`), а `ProfileScreen` — профиль под Настройками.
Скрытые слои `inert` + `aria-hidden`; во время свайпа предыдущий слой раскрывается под текущим.
Возврат использует тот же экземпляр и сохраненную прокрутку, без повторной анимации входа.
Не заменять стек одиночным `key={tab}`: это снова даст пустой фон и повторную загрузку при свайпе.
Новая вкладка сбрасывает стек; смена пользователя размонтирует все слои (`key={user.id}`).

Персональный `meta` в Dexie: `goal_${userId}` (**синкается** через таблицу `goals`);
`prog_${userId}`, `badges_${userId}`, `notif_seen_at_${userId}` (**синкаются с v5.5.0** через таблицу
`user_meta`, см. ниже); `priv_${userId}`, `wm_*`/`sig_*`, `user_meta_state`, `merge_conflicts`, `fb_replies_${userId}` (v6.12.0, кэш
ответов разработчика из `my_feedback` для «Уведомлений», `db/feedbackReplies.js`) —
**не синкаются** (служебное/устройство-специфичное). Черновик НОВОЙ тренировки (состав, оценки
RPE) — в `localStorage` под `gym_app_workout_{draft,feel}_new_${userId}` (отметки «подход выполнен» и их
ключ `…_done_new_…` убраны в v6.1.0: что в строках — то и записывается, лишний подход удаляется ✕)
через `lib/draftStore.js` (память + диск, v5.15.1): переживает выгрузку PWA и перезагрузку, в синк
не идёт — это незавершённое действие на одном устройстве. **Выбранный акцент** (v6) — `localStorage`
`gym_app_accent` на устройстве (сплэш и первый кадр рисуются до входа) И с v6.2.0 синкаемый род `accent`
в `user_meta` (LWW): экран «Оформление» пишет `repo.setAccentPref` (значение `{id, hue, by: userId}`),
`hooks/useAccentSync` применяет ТОЛЬКО значение со своим `by` к `<html>` и кладёт в `localStorage` с
владельцем. ⚠️ `localStorage` один на устройство, учёток на нём несколько: в v6.2.0 хук заливал «найденный
на устройстве» выбор в учётку вошедшего — цвет одной учётки утекал в другую (инцидент 30.09). Поэтому
автозаливки нет, значения без `by` игнорируются, а чужой/«ничей» цвет устройства при входе сбрасывается
на акцент по умолчанию — **фиолет** (с v6.15.3; до этого вольт: `DEFAULT_ACCENT` в `lib/accent.js` = `id` в `public/accent-boot.js` = токены `:root` в `index.css`).

⚠️ **Метка инкрементального pull лежит там же, где её данные.** `wm_*`/`sig_*` — в персональной
базе, но `sig_login_users` — в login-meta ОБЩЕЙ `loginDb` (`getLoginMeta`/`setLoginMeta`), потому
что описывает общий ростер. Разъезд «данные в одной базе, метка в другой» уже стоил данных: экран
входа портил ростер в `loginDb`, метка в персональной `meta` не менялась, `pull` считал, что тянуть
нечего, и пол не восстанавливался НИКОГДА (инцидент 29.07.2026). Кэш ростера пишет ровно один
писатель — `repo.cacheUsers`, всегда мержем через белый список `lib/roster.js`.

**Синк личного `meta` (v5.5.0):** сервер — одна таблица `user_meta(user_id, key, value jsonb,
updated_at)` + `upsert_user_meta` (`supabase/user-meta.sql`, RLS «только свои», владелец из
`app_uid()`, БЕЛЫЙ СПИСОК ключей). Клиент: чистое слияние по типу ключа в `lib/userMeta.js`
(`notif_seen_at` → максимум, `badges` → объединение с самой ранней датой, прочее → LWW), состояние
`user_meta_state` в `meta`, стадии `pullUserMeta`→`pushUserMeta` в `syncNow` под своим `try/catch`.

⚠️ **Новую пользовательскую сущность в `meta` (вес тела, заметки) класть ТОЛЬКО вместе с синком:**
добавить род в `SYNCED_KINDS` (`lib/userMeta.js`) И в белый список `upsert_user_meta` (иначе push
падает с `unknown user_meta key`), при необходимости — своё правило слияния. Ключ должен иметь вид
`${kind}_${userId}`. Иначе значение снова теряется при смене устройства. Любая
пользовательская запись синкаемого ключа (включая восстановление из бэкапа) — только через
`writeSyncedMeta`: голый `setMeta` не ставит `dirty`, и ближайший pull по LWW отдаёт победу серверу.

## Серверные каноны и грабли (`supabase/`, git-ignored)

- **Дисциплины рейтинга (v6.9.0, SQL до выката клиента)** → `rating-disciplines.sql`:
  новые `rating_catalog`/`rating_board`/`admin_save_discipline`, таблица закрыта от клиентов;
  RPC проверяют `app_uid`, мутация также `is_admin`; результаты исключают приватных + `can_see_user`.
  `db/disciplines.js` — read-only витрина, персональные снимки в meta, без новой схемы Dexie;
  привилегированные онлайн-мутации — `lib/adminDisciplines.js` по существующей модели `lib/admin.js`.
  Старый `leaderboard_bench` не переписывать ради дисциплин (он остается для совместимости).
  Перед внедрением кругов нужен scope конфигурации/результатов; нынешняя таблица — общий круг.

Функции переписывались несколько раз, и `create or replace` со старым телом уже дважды ломал прод.
Канон каждой функции — в файле ниже; НЕ перезапускать её тело из более старого `.sql`:

- **`upsert_template`** → канон `template-targets-fix.sql` (хардненинг `security definer` +
  `search_path` + владелец из `app_uid()` И тело с обеими формами `p_exercise_ids`: uuid-строки и
  объекты `{id,sets,reps,weight}`). Иначе push шаблонов падает на касте `::uuid` → dead-letter.
- **`upsert_workout`** → канон `merge-clock-noop.sql` (поверх `merge-clock-fix.sql`): обязательны
  `security definer` + `set search_path = public` + проверка владельца, плюс ранний выход без
  записи, если состав и `performed_at` не изменились (иначе холостой сдвиг `updated_at` даёт ложные
  конфликты merge-часов). Без хардненинга — `permission denied for table`, push ломается.
- **`admin_update_exercise`** → канон `admin-exercise-metric.sql` (v6.3.6: `p_submuscle`/`p_secondary` +
  `p_metric`, 9 аргументов), НЕ тела из `muscle-detail.sql` / `gender-leaderboard.sql`. Клиент шлет `p_metric`
  только при смене типа — обычная правка совместима с сервером без этого файла.
- **`new_prs_for_workout` / `tg_digest_window`** → канон `telegram.sql`: ведущая метрика
  (`weight`/`reps`/`time`) + контракт `metric/value` + фильтр приватности. После изменения SQL
  зафиксировать в результате задачи необходимость передеплоя `tg-record` И `tg-digest` с
  `--no-verify-jwt`; сам деплой выполнять только по прямой просьбе пользователя. `tg-record`
  отправляет все рекорды одной тренировки одной пачкой, иначе Telegram flood limit обрезает хвост.
  Trigger `tg_notify_record()` не должен содержать webhook-секрет в теле: брать его из
  `vault.decrypted_secrets` по имени `tg_record_webhook_secret`; канон и порядок ротации —
  `commercial-hardening-webhook-vault.sql` / `commercial-hardening-deploy.md`.
- **`upsert_user_meta`** → канон `user-meta-fav.sql` (v6.5.0, белый список `badges/prog/notif_seen_at/
  rpe/accent/fav`; поверх `user-meta-accent.sql`, файл сверяет живое тело guard-блоком перед заменой). Не
  перезапускать тело из `user-meta.sql` / `user-meta-accent.sql`. Новый род в `SYNCED_KINDS` — В КОНЕЦ списка.
- **`set_my_sex`** (v6.2.0) → канон `set-my-sex.sql`: свой пол, владелец из `app_uid()`, холостой вызов не
  двигает `users.updated_at`. Чужой пол — только `admin_set_sex`.
- **`admin_list_users` / `login_users` / `admin_set_sex`** → канон `roster-contract.sql`. НЕ
  пересоздавать из `admin.sql` / `private-user.sql` / `user-order.sql` / `gender-leaderboard.sql`:
  `drop+create` там снимает `sex`/`sort_order` с контракта функции, админка показывает пол как «не
  задан» у всех и **затирает его в БД** при сохранении участника (инцидент «у всех слетел пол»,
  29.07.2026; устаревшие блоки в старых файлах закомментированы с маркером). `login_users` менять
  только через `create or replace` **без `drop view`** — `drop` снимает grant для `anon`, а вью
  читал пикер входа ДО авторизации (до 6.12.0; дальше — только вошедшие, см. «Вход по имени»), а
  `drop` снимает и грант `authenticated`; колонки можно только дописывать в конец.
- **`leaderboard_bench`** → канон `server-hardening-2026-10.sql` (v6.7.6: SECURITY DEFINER + видимость
  `can_see_user` + Эпли только до 12 повторов; собран поверх живого тела из `leaderboard-actual-weight.sql`).
  После него `is_private_user`/`are_connected` у `authenticated` ОТОЗВАНЫ: новая функция, доступная клиенту
  и зовущая их, обязана быть DEFINER (иначе permission denied), политики — только через `can_see_user()`.
  Дальше — история прежнего канона: строка участника выбирается по
  САМОМУ ТЯЖЁЛОМУ подходу, `orm` — отдельный максимум по всем его подходам (сноска в UI). НЕ
  пересоздавать из `leaderboard_bench.sql` / `leaderboard-bench-fix.sql` / `gender-leaderboard.sql`:
  там отбор `order by orm desc`, и борд показывает подход с лучшим расчётным 1ПМ вместо фактического
  рекорда (участник выжал 90×1 — в борде висело 85×4, потому что 85×4 по Эпли = 96.5 > 90; заодно
  врал разрыв в «Ближайшем ориентире»). Клиент ранжирует по `weight` (`cmpBoard`), его офлайн-фолбэк
  `computeBoardFromFeed` — тот же контракт; расходился только сервер.
  ⚠️ **`leaderboard-bench-fix.sql` на прод НЕ накатан** (проверено дампом 15.08.2026): боевая
  функция — догендерная, БЕЗ колонки `board`, без женского борда и без `security definer`. Поэтому
  женский рейтинг (ягодичный мостик) на сервере не существует, а клиент молча мапит отсутствующий
  `board` в `'m'`. Канон выше собран поверх РЕАЛЬНОГО тела; гендерный борд — отдельная задача
  (меняет тип возврата → `drop` + повторные гранты + `security definer` из-за чтения `u.sex`).
- **Политики чтения тренировок** (`workouts_select`/`we_select`/`sets_select`) → канон `feed-rls-speed.sql`
  (07.10.2026): `user_id in (select visible_user_ids())` — список видимых считается один раз на запрос.
  НЕ возвращать `can_see_user(...)` на каждую строку (`auth-harden.sql` / `private-user.sql`): Лента на
  77 тренировках шла 3,8 с и падала по statement timeout (57014 → 500). Логика видимости — по-прежнему
  только в `can_see_user()`; новая политика по владельцу — тем же приемом.
- **Пути чтения вне Ленты** (`users_read`, вью `login_users`, `exercises_read`, `wt_select`/`te_select`,
  `reactions_select`, `avatars_owner_read`, гранты `user_meta`) → канон `privacy-read-paths.sql` (07.10.2026, П2
  `PLAN-friend-code.md`): «чье-то» видно, только если владелец в `visible_user_ids()`; упражнение невидимого
  владельца видно, если стоит в видимой тренировке/шаблоне. НЕ пересоздавать эти политики из
  `server-hardening-2026-10.sql` / `auth-harden.sql` / `reactions.sql`, а `login_users` — из `roster-contract.sql`
  без фильтра (колонки те же, `create or replace` без `drop`). Листинг бакета `avatars` — только своей папки
  (публичные ссылки бакет отдает сам). `user_meta` клиенту — только `SELECT`, запись — DEFINER `upsert_user_meta`.
  Запись в упражнения — канон `exercise-owner.sql` (только `owner_id = app_uid()`, ничье = общее).
- **Правило видимости — одно ядро `user_can_see(viewer, owner)`** → канон `visibility-core.sql` (07.10.2026, П5
  `PLAN-friend-code.md`): `can_see_user(p) = user_can_see(app_uid(), p)`, `push_can_see = user_can_see`. Ветки
  `is_admin()` в видимости НЕТ — админ видит контент как участник (свои связи + общее), Админка — под `is_admin()`
  с `aal2`. Новую ветку видимости — ТОЛЬКО в ядро. С 07.10 (круги) канон ТЕЛА ядра — `friend-circles.sql`
  (ветка `fc_share_active`); `visibility-core.sql` — только для `can_see_user`/`push_can_see`, ядро из него не перезапускать. НЕ пересоздавать `can_see_user` из `connections.sql` /
  `private-user.sql`, `push_can_see` — из `push-types.sql`. Ядру EXECUTE только `service_role` (иначе клиент
  спрашивает про чужие пары).
- **Приватность:** в `leaderboard_bench`, `tg_*` и `goal_reached_for_workout` обязателен фильтр
  `not is_private_user(...)` — бот и лидерборд ходят под service_role в обход RLS.
- **`goal_reached_for_workout`** → канон `goal-reached-private.sql` (v6.7.5: фильтр приватности +
  `search_path`). НЕ перезапускать тело из `goals.sql` / `goals-metric.sql` / `goals-reps.sql`: там
  фильтра нет, и в общий чат уходит «Имя достиг цели» приватного участника (было на проде до 02.10).
- **`push_subscribe` / `set_my_avatar_url` / триггер `trg_touch_users`** → канон `server-hardening-2026-10.sql`
  (v6.7.6): endpoint только FCM/Apple/Mozilla/Windows и ≤10 подписок на человека; аватар — только своя
  папка `avatars/<app_uid>/`; служебные колонки users (`last_login_at`, PIN, `session_epoch`, `auth_uid`)
  `updated_at` не двигают — иначе анонимный `login_users.updated_at` выдает время каждого входа. Служебные
  таблицы `auth_attempts`/`audit_log`/`admin_rate`/`tg_announced` — без прав у anon/authenticated (только
  service_role и DEFINER-функции). Политики чтения `users`/`exercises` — `app_uid() is not null`, не `true`.
- **Обращения «Написать разработчику» (v6.11.0)** → канон `feedback.sql`: таблица `feedback` закрыта
  от клиентов, только DEFINER RPC (`submit_feedback`/`my_feedback`/`ack_my_feedback` — по `app_uid()`,
  `admin_list_feedback`/`admin_update_feedback` — гейт `is_admin()`). Edge `feedback` деплоится С проверкой
  JWT (без `--no-verify-jwt`) и зовет RPC клиентом С JWT вызывающего — личность и права решает SQL, а не
  Edge. Запись в БД раньше Telegram. Пуш автору — тип `feedback` в `sendToUser` (в `push_prefs` его нет,
  он всегда включен); решение «слать ли» — поле `notify` из `admin_update_feedback`. Скриншоты — приватный
  bucket `feedback`, запись только в `<app_uid>/`, чтение только `is_admin()`. Онлайн-операции —
  `lib/feedbackApi.js`, исключение из очередей синка, как приглашения.
  **v6.12.0 — ответ из Telegram** → канон `feedback-tg.sql`: `my_feedback`/`admin_list_feedback`/
  `admin_update_feedback` (новые колонки в конце контракта; `feedback.sql` после него НЕ перезапускать),
  `reopen_my_feedback`/`feedback_media_ref` (authenticated), `bot_*` (в т.ч. `bot_feedback_note`) — EXECUTE только `service_role`.
  Edge `tg-bot` — `--no-verify-jwt`, вход только с `X-Telegram-Bot-Api-Secret-Token` = `TELEGRAM_WEBHOOK_SECRET`,
  принимает лишь `TELEGRAM_OWNER_ID` в `TELEGRAM_FEEDBACK_CHAT_ID`, update_id — через `bot_claim_update`.
  Картинки обращений в Supabase не храним: `file_id` Telegram, байты клиенту — только через `feedback`
  action=media после `feedback_media_ref`; токен бота клиенту не отдается. Вебхук у бота один — `getUpdates`
  нигде не использовать.
- **Дистанция (v6.12.0)** → канон `metric-distance.sql`: `admin_update_exercise`, `new_prs_for_workout`,
  `push_beaten_for_workout`, `admin_save_discipline` (поверх живых тел 05.10). НЕ перезапускать их тела из
  `admin-exercise-metric.sql` / `telegram.sql` / `push-types.sql` / `rating-disciplines.sql` — там нет
  `distance`. Подход дистанции — `{weight: км, reps: секунды}`; ведущий показатель рекорда — `weight` (км);
  тоннаж, цели, 1ПМ, прогрессия и дисциплины рейтинга дистанцию не учитывают (`lib/metric.js setTonnage`).
- **Логин отдельно от имени (П4, 07.10.2026)** → канон `login-separate.sql`: `users.login` (`[a-z0-9_.]`, 3–20, с
  буквы, нижний регистр, уникален) — для входа, клиенту НЕ отдается (ни в `login_users`, ни в грантах колонок),
  виден только владельцу (`my_login`/`set_my_login`, статусы ok|taken|bad|limited, 10 смен/час). Имя — любое,
  1–30, НЕ уникально (`users_name_key_uidx` снят — тезок не ловить). Проверка логина — одна: `login_check`
  (формат + резерв + занятость), список резерва = `src/lib/login.js`. Канон `auth_find_user` и `invite_redeem`
  (+`p_login`, имя ≤30) — этот файл, НЕ `login-join.sql` / `invites.sql`: логин точно → иначе старое имя только у
  учеток БЕЗ логина и только целиком (поиск по началу убран). Вход по id — `auth_login_id_claim` (корзины
  `id:<учетка>:<IP>` 5/15 мин + `iduser:<учетка>` 30/сутки, лок на адрес, не на учетку); сброс всех корзин
  входа учетки — `auth_login_id_reset` (сброс PIN). `login` в `touch_users_updated_at` — служебная колонка.
- **«Мой круг» (этапы 4–6, 07.10.2026)** → канон `friend-circles.sql` (+ `friend-circle-rating.sql`,
  `weekly-summary.sql`). Видимость круга — ТОЛЬКО ветка `fc_share_active` в ядре `user_can_see` (канон тела
  ядра переехал сюда из `visibility-core.sql`): оба `active` в одном круге. `pending` не видит никого. Код —
  личный, многоразовый, 8 знаков Crockford; хранится и хэш (поиск), и сам код (повторный показ держателю) —
  таблица закрыта, только DEFINER. Все невалидные коды — ОДИН ответ `invalid`; попытки — `fc_attempt`
  (`auth_throttle`: `fcuser:<uid>` / `fcip:<ip>`, 10/час). Регистрация новичка по коду — только штатным
  каналом: `fc_issue_invite` (строка `invites` от держателя на 30 мин, держит слот) → `invite_redeem` (тело не
  менять; гасит `used_by` → newcomer-private) → `fc_after_redeem`. `invites.fc_code_id` — служебные, в «Мои
  приглашения» и лимит 3 не входят (канон `create_my_invite`/`my_invites` — здесь, не `member-invites.sql`).
  П10: `fc_config` (суточный лимит регистраций по кодам, потолок круга). Владелец круга — НЕ админ: права только
  в своем круге. Удаление учетки — `fc_on_account_delete` (владение самому раннему active, пустой круг —
  удалить) из `account_delete`. Рейтинг круга — свой каталог `friend_circle_disciplines` (копия общего при
  создании), доска — по active-участникам, приватные внутри круга видны; общий рейтинг/Telegram — без
  изменений. Клиент: `lib/friendCircles.js`, `screens/CircleScreen.jsx`, `components/circle/*`, `#join=<код>`
  в App (без учетки — InviteScreen `code`, с учеткой — «Мой круг»); доски — `DisciplineLeaderboard`
  (`db/disciplines.js` с `circle`, `db/circles.js`). Пуши — Edge `push-circle` (тип `circle`, всегда вкл.).
- **Удаление аккаунта (П7, 07.10.2026)** → канон `account-delete.sql` (`account_delete(p_uid, p_actor)`, только
  service_role) + Edge `account-delete` (`{pin}` — себя, с `auth_rate_claim` до сверки PIN; `{target_user_id}` —
  админ с 2FA, 10/час). Сразу и насовсем. Учетки `role = admin` так не удаляются (409). Порядок: SQL одной
  транзакцией → Storage `avatars/<id>/`, `feedback/<id>/` → `auth.admin.deleteUser`; сбой последних двух
  удаление не откатывает. Шаблоны удалять ЯВНО (`workout_templates.user_id` — set null, иначе остались бы
  ничьими). Свои упражнения: неиспользуемые — удалить, остальные → общими (триггер `exercise-owner.sql`);
  `rating_disciplines.exercise_id` — CASCADE, поэтому проверка «никем не используется» явная, иначе удаление
  снесло бы дисциплину. Обращения и `audit_log` — обезличить (не стирать). Новая таблица со ссылкой на
  `users` — решить ее судьбу здесь (cascade/обезличить) и добавить в тест. Клиент: `profile/DeleteAccount.jsx`,
  после ответа — выход и `db/local.js wipeLocalAccount` (персональная база, ростер, кэш PIN, ключи localStorage).
  Старый `admin_delete_user` (Админка до 6.18) — не использовать.
- **«Забыл PIN» без админа (П1, 07.10.2026)** → канон `pin-recovery.sql` + Edge `pin-reset` (`--no-verify-jwt`)
  + ветка в `tg-bot`. Два пути: Telegram (привязка — одноразовый `t.me/<бот>?start=<токен>`, хранится ТОЛЬКО
  chat id в `tg_links`; ссылка сброса `…#reset=<токен>`, 10 мин, один раз) и код восстановления (16 знаков
  Crockford, показ один раз, новый гасит старый). В базе только SHA-256 секретов (`invite_token_hash`).
  `pin_reset_request` отвечает ОДИНАКОВО для любого логина и учетки без Telegram — не добавлять в ответ
  «нет такого»/«не привязан». Финал сброса один — `pin_reset_finish` (PIN, `admin_kill_sessions`,
  `auth_rate_reset`, `auth_login_id_reset`, остальные ссылки гаснут). Адрес в ссылке — только `APP_URL` /
  `CORS_ALLOWED_ORIGINS`, не из запроса. `tg-bot` принимает от НЕ-владельца лишь `/start <токен>` и `/stop`
  в личке (`_shared/tgLink.ts`), все прочее — по-старому только владелец. Сброс владельцем круга — НЕ делать.
  Клиент: `lib/recovery.js` (токен из `#reset=` стирается из адреса сразу, как приглашение),
  `components/recovery/*`, `screens/ResetPinScreen.jsx`, `profile/RecoverySection.jsx`.
- **Вход по имени и «Хочу в круг» (v6.12.0)** → `login-join.sql`: `auth_find_user` (с П4 — канон
  `login-separate.sql`, см. выше), `join_requests` и `join_*`/
  `bot_join_decide` — ТОЛЬКО `service_role`. Edge `auth-login` принимает `{name, pin}`: не найдено — тот же
  401 и та же цена PBKDF2 (пустышка). Edge `join-request` — `--no-verify-jwt`, лимит 3/сутки на IP-хэш и 20
  ожидающих, honeypot; приглашение создается в `join_poll` один раз (в базе только хэш токена). Кнопки —
  `jr:<id>:a|d` в `tg-bot`. Экран входа ростер НЕ читает: пикер = учетки с `pin_*` в `loginDb.meta`
  (`auth.knownAccounts`). **`login_users` с `login-users-close.sql` закрыт от anon** (только authenticated) —
  накатывать сразу ПОСЛЕ тега клиента, не до (6.11.x живет на кэше ростера, ошибку показывает лишь при пустом
  кэше); правило «create or replace без drop view» остается.
- **Приглашения участников (v6.10.0)** → добавочный канон `member-invites.sql`: `create_my_invite`,
  `my_invites`, `revoke_my_invite` проверяют `app_uid()` и владельца; лимит 3 активных ссылок
  сериализован на автора, срок 7 дней. Онлайн-операции в `lib/memberInvites.js` — исключение
  из очередей синка, как админские приглашения; сырой токен только в памяти открытой панели.
- **Новичок по приглашению приватен (v6.12.1)** → `newcomer-private.sql`: триггер `trg_invite_newcomer_private`
  (AFTER UPDATE OF used_by на `invites`) ставит `users.is_private = true` и связь `connections` с
  `invites.created_by` (если есть). Тело `invite_redeem` ради этого НЕ менять; новый путь регистрации обязан
  гасить ссылку через `invites.used_by`, иначе новичок увидит всю Ленту. Доступ дальше — админ (приватность/связи).
- **Приглашения (v6.8.0)** → канон `invites.sql` (тело `invite_redeem` — с П4 `login-separate.sql`). Уникальность
  ИМЕН снята в П4 (07.10.2026) — уникален логин (`users_login_uidx`, `23505` → «логин занят»). `user_name_key`
  (свертка регистра `translate` по кириллице: при collation `C` `lower()` ее не трогает) остается для
  переходного входа по имени. Регистрация — только через `invite_redeem`
  (service_role, Edge `invite-redeem` с `--no-verify-jwt`); сырой токен в базу и логи не пишем — только SHA-256.
- **Смена упражнения в админке → снимки в тренировках (v6.7.6).** Сервер `workouts.updated_at` НЕ двигает (на
  workouts триггеры Telegram и пушей — старые рекорды объявились бы заново); клиент сам перечитывает по id
  свои чистые тренировки с изменившимися упражнениями (`db/sync/pull.js refreshWorkoutsForExercises`).
- **Лимит попыток PIN** → канон `auth-rate-claim.sql` (v6.7.5): попытка ЗАНИМАЕТСЯ `auth_rate_claim`
  до проверки PIN, под блокировкой строки; лок растет 15 мин → 1 ч → 4 ч. С П4 (07.10.2026) — только смена
  PIN; вход по имени — корзины `login-throttle.sql`, вход по id — `auth_login_id_claim` (`login-separate.sql`). Не возвращать в Edge
  Functions схему «`auth_rate_guard` → проверка → `auth_rate_fail`»: параллельные запросы обходят
  ее (перебор PIN пачками). Ошибка RPC лимита = отказ (500), не пропуск.
- **Лимиты входа по имени и IP (v6.14.0)** → канон `login-throttle.sql`: корзины `auth_throttle`
  (`auth_throttle_claim/_reset`, лок растет и затухает через сутки), `auth_ip_claim` (30 попыток/15 мин с
  адреса, оба пути), `auth_login_name_claim` (имя → id + корзины `name:<ключ>:<IP>` 5/15 мин и
  `nameuser:<учетка>` 30/сутки — ОДИНАКОВО для существующих и несуществующих имен). Вход по имени
  `auth_rate_claim` НЕ трогает: иначе по 429 выясняется, кто в круге, и чужую учетку можно запереть.
  Решение «пустить/401/429» — чистая `decideLogin` (`functions/auth-login/logic.ts`, тест —
  `logic_test.ts`: ненайденное имя проходит те же шаги). IP — только `_shared/ip.ts`: `cf-connecting-ip` →
  ПОСЛЕДНИЙ `x-forwarded-for` (первый подставляет клиент), IPv6 — по /64, в базу — HMAC. Канон
  `join_submit` — тоже здесь (потолок 20 ожидающих — только заявки моложе 7 дней).
- **2FA админки (v6.14.0)** → канон `is_admin()` в `admin-mfa.sql`: роль admin И (`auth.jwt()->>'aal' =
  'aal2'` ИЛИ у auth-учетки нет подтвержденного фактора в `auth.mfa_factors`). НЕ пересоздавать
  `is_admin()` из `admin.sql`/`bootstrap.sql` — 2FA молча перестанет действовать. Edge, проверяющая
  `users.role` сама (`admin-create-user`, `admin-reset-pin`), обязана звать `mfaRequired`
  (`_shared/mfa.ts`) → 403 `mfa_required`. Клиент: `lib/adminMfa.js` + `components/AdminMfa.jsx` (код
  перед Админкой, включение/отключение) — онлайн, вне очередей синка. Нужен включенный TOTP в
  Supabase → Authentication → Multi-Factor. Аварийное снятие — SQL из шапки `admin-mfa.sql`.
- **Деплой Edge Functions — с `--use-api`** (06.10.2026, CLI ≥ 2.119): сборка на стороне Supabase, Docker
  не нужен и не всплывает «Docker is not running». Пример: `supabase functions deploy --use-api tg-bot --no-verify-jwt`.
  Так же — в `supabase/*-deploy.md`, шапках функций и git-блоках для пользователя.
- **Зависимости Edge Functions (v6.14.0):** только `npm:<пакет>@<точная версия>` (не `esm.sh`, не
  плавающие `@2`); транзитивные — в `supabase/functions/deno.lock` (`deno.json` рядом). Поднял версию —
  во ВСЕХ импортах сразу и `deno cache */index.ts` из `supabase/functions`. Тесты Edge:
  `DENO_NO_PACKAGE_JSON=1 deno test --allow-env` оттуда же (иначе Deno цепляет `package.json` клиента).
- **Тесты сервера в CI (v6.14.2)** — только в ПРИВАТНОМ репо: `.github/workflows/server-tests.yml`
  (публичный `.gitignore` его исключает; в приватный — `pgit add -f`). Джобы: SQL-тесты
  `supabase/tests/*.test.mjs` на PGlite через `node supabase/tests/run-all.mjs <pglite/dist/index.js>`
  и `deno test` + `deno check */index.ts` в `supabase/functions` (`--frozen`: lock обязан быть свежим).
  Правка SQL-канона → свой `*.test.mjs` (синтетика, повторный накат, ACL); новый файл подхватывается сам.
- **ACL после каждого `create/create or replace` проверять отрицательно.** В Supabase default
  privileges могут снова выдать `ALL/EXECUTE` клиентским ролям. Канон `login_users`: сначала
  `revoke all` у `PUBLIC`/`anon`/`authenticated`, затем только явно нужный `SELECT`; простой view
  автоматически обновляем и без `security_invoker` исполняется с правами владельца, поэтому
  `GRANT UPDATE/DELETE` обходит ожидаемую защиту RLS. Внутренние Telegram/trigger helpers
  (`tg_try_claim_goal`, `tg_notify_record`, `touch_updated_at` и аналоги) — `EXECUTE` только
  владельцу/service_role; снять нужно в том числе с `PUBLIC`, а не только с `anon`.
- Порядок применения `.sql` и деплой-заметки — в `supabase/*-deploy.md`; переход на версионированные
  миграции — scaffold в `supabase/migrations/` (`config.toml`, README).

---

## Где задачи и документация

- **`docs/BACKLOG.md`** — **единственный источник задач** (баги + виши + техдолг). Сверху открытые
  задачи с приоритетами (🔴/🟡/🟢) и тегами `[баг]`/`[виш]`/`[техдолг]`, ниже архив и «Лог проходов»
  (последний месяц; старое — в `docs/log/ГГГГ-ММ.md`).
- **`docs/PASPORT.md`** — обзор проекта (цель, стек, структура файлов, экраны, статус) + подробная
  «Архитектурная история подсистем» (перенесена из этого файла 24.07.2026).
- **`docs/plans/PLAN-*.md`** — планы крупных фич (реферанс решений, не источник задач).
- **`docs/reviews/`** — отчёты код-ревью и предложения по проекту (реферанс).
- **`src/content/whatsNew.js`** — «Что нового» ВНУТРИ приложения (v6.4.0; анонсы в Телеграме с
  01.10.2026 не пишутся). Это поставляемый контент: лист после обновления, экран «Обновления», заголовок
  строки новой версии (`version.json`). **Если просят «чейнджлог» — это он.** Правила — в шапке файла:
  одна запись на календарный день под последней версией дня (новые — СВЕРХУ), `main` — 2–4 главных
  пункта, `minor` — мелочи, пункт — одна строка «эмодзи + польза» на языке друзей, `headline` ≤ 45
  символов, ~5 последних записей. Тест сверяет, что свежая запись = версия из `package.json`.
  **Только то, что полезно участнику** (v6.16.0): админка, сервер, Telegram-бот, заявки и регистрация
  глазами новичка (их читают те, кто уже внутри), CI, зависимости, рефактор — НЕ сюда, а в
  **`docs/CHANGELOG-dev.md`** (закрытый, коммит через `pgit add -f`). Формат
  dev-чейнджлога: `## <версия> · <дата>`, пункты списком «что и где», свежие сверху.
- **`docs/log/анонсы-телеграм.md`** — архив телеграм-анонсов до v6.3.8 включительно, больше не ведется
  (до v6.16.0 лежал как `docs/CHANGELOG.md`).
- **`README.md`** (в корне) — пользовательское описание приложения, идёт в GitHub.
- **`docs/quick-start.md`** — «Быстрый старт» для участников: как войти, записать тренировку и где что
  лежит (отслеживается в публичном репо, ссылка из README). Обновляется по DoD п. 4.
- **`archive/ТЗ.md`** — исходное техзадание: архив/реферанс, НЕ источник задач.

---

## Особенности среды

- **Проверки на проде для пользователя (правило пользователя, 07.10.2026)** — ОДНИМ запросом прямо в ответе
  (не «запросы из хвоста файла»): SQL Editor показывает результат только последнего запроса. Запрос возвращает
  таблицу строк `check | expected | actual` (+ `ok`), по строке на проверку; многострочные значения (тела функций)
  — отдельными строками/ячейками, не «пришли одной строкой». Только чтение.
- Рабочая среда — Windows/PowerShell. Для поиска сначала использовать `rg`/`rg --files`, для
  чтения — доступный файловый инструмент или `Get-Content -Encoding UTF8`.
- По умолчанию проверки запускать прямо в рабочей папке: `npm test` и `npm run build`.
  Чистая сборка через `git archive` нужна только при подозрении на повреждённый кэш/файлы,
  необъяснимой локальной ошибке или расхождении с CI.
- Если установка зависимостей или важная проверка упала из-за сети/прав песочницы, повторить
  необходимую команду с запросом разрешения. CI — резервная проверка, а не замена локальной по
  умолчанию.
- **Файлы — CRLF (Windows), в git блобы — LF.** `git diff` может показывать целые файлы как
  изменённые — это переносы строк, а не порча.
- Read-only команды git (`status`, `diff`, `log`, `show`, `archive`) разрешены — **только с
  `GIT_OPTIONAL_LOCKS=0`** (PowerShell: `$env:GIT_OPTIONAL_LOCKS=0`; bash: `export GIT_OPTIONAL_LOCKS=0`):
  обычный `git status` обновляет индекс и берет `.git/index.lock`, а из песочницы агента (Cowork VM)
  удалить его не может — висящий lock ронял `git add`/`commit` пользователя, а тег в том же блоке
  уходил на старый коммит (инцидент 05.10, v6.12.0). Commit/push/смену ветки агент без прямой
  просьбы не выполняет.
- **Висящий `index.lock` (правило пользователя, 05.10.2026):** если `.git/index.lock` (или
  `.private-git/index.lock`) существует и ни один процесс git не запущен — это мусор от упавшего
  процесса, его удаляем. Сам агент не удаляет (из песочницы и не может) — первая строка каждого
  git-блока для пользователя делает это сама (см. DoD п. 6).

---

## Definition of Done (обязательные шаги каждой задачи)

1. Реализовать в минимальном наборе файлов; не выходить за границы задачи.
2. **Проверка пропорциональна изменению:**
   - код приложения, тесты или поставляемая конфигурация → затронутые тесты, полный `npm test` и
     `npm run build`;
   - только документация или рабочие инструкции (`AGENTS.md`) → проверить diff, ссылки, формат и
     непротиворечивость; npm-прогоны не обязательны;
   - диагностические ad-hoc прогоны допустимы, но не заменяют постоянный тест на исправленный
     программный кейс.
   - **правка разметки, классов или подписей кнопок** в сценарии «вход → запись тренировки →
     история» (таббар, «+», композер, итог, история) → ещё и `npm run test:e2e`: CI гоняет этот
     smoke ПЕРЕД выкаткой по тегу, и упавший e2e молча отменяет деплой (v6.0.1: тест искал `.fab`,
     а «+» переехала в меню). В e2e искать элементы по роли и подписи, а не по классу.
3. **Поднять версию приложения** в `package.json` по строгому semver, если задача меняет
   отслеживаемый код приложения, тесты, UI или поставляемую конфигурацию (версия видна внизу
   «Профиля»). Анализ, ревью, планы, git-ignored документация и рабочие инструкции без изменения
   продукта версию не меняют:
   - **PATCH** (`x.y.Z+1`) — багфиксы, UX-полировка, изменения поставляемых текстов/стилей,
     тесты и внутренний техдолг в отслеживаемом коде. Дефолт, если задача не подходит под
     MINOR/MAJOR.
   - **MINOR** (`x.Y+1.0`) — новая обратно совместимая фича (новый экран/возможность); PATCH → 0.
   - **MAJOR** (`X+1.0.0`) — ломающие изменения: несовместимая миграция схемы Dexie/синка, крупный
     редизайн/переработка модели; MINOR и PATCH → 0.
   - В сомнениях брать меньший разряд; одна продуктовая задача = один бамп. Версию и разряд
     упомянуть в «Логе проходов»; для задачи без бампа явно записать причину.
4. Для реализованной задачи из бэклога обновить **`docs/BACKLOG.md`** (пометка `[x]` + запись в
   «Лог проходов»: что сделано, какие файлы, как проверено, новая версия/разряд либо причина без
   бампа). В **`README.md`** при бампе обновить строку версии **внизу**; описание возможностей менять
   только при пользовательском или обзорном изменении. **`docs/quick-start.md`** (Быстрый старт, ссылка
   из README) — если правка меняет то, что там описано или должно быть описано: новая возможность,
   экран или кнопка, другое название или место в интерфейсе, другой порядок действий, ограничение
   (офлайн, iPhone). Сверять с кодом, а не по памяти; техдолг и правки вне описанного не трогают.
   Как и README, его правка версию не поднимает. **`docs/PASPORT.md`** — если правка затронула
   обзорные сведения (стек, версия
   схемы Dexie, список экранов/фич, структура файлов, статус, карта документации) или архитектуру
   подсистемы. **Этот `AGENTS.md`** — только если изменился инвариант, серверный канон или правило
   работы (историю подсистем сюда НЕ возвращаем — она живёт в ПАСПОРТЕ).
   **`src/content/whatsNew.js`** — если правка заметна пользователю (новая фича, видимая починка,
   изменение UX), по правилам выше: при бампе запись дня получает новую версию (иначе упадет тест
   `lib/whatsNew.test.js`); чисто внутренние правки (техдолг, рефактор, серверное без видимого
   эффекта) туда не идут — их пишем в `docs/CHANGELOG-dev.md`. Если день без видимых правок, но версия поднялась — версию записи дня все
   равно двигаем (или заводим короткую запись), иначе лист у друзей не всплывет.
   **Скриншоты README (`docs/screenshots/`)** — если правка ЗАМЕТНО меняет экран, который там снят
   (раскладка, тексты, цвета, новые/убранные элементы; не рефактор и не правка вне кадра), переснять
   ТОЛЬКО затронутые: `npm run shots:readme -- <имена>` и включить PNG в `git add` той же задачи.
   Все подряд не переснимать: даты в кадре считаются от «сейчас», и каждый прогон меняет файлы.
   Какой экран откуда (имя → что в кадре → главные файлы):
   `home` — Главная (`HomeScreen.jsx`); `recovery` — Восстановление (`FreshnessScreen.jsx`, `MuscleMap.jsx`);
   `workout` — новая тренировка с рекомендацией (`WorkoutScreen.jsx`, `ExerciseCard.jsx`);
   `progress-overview`/`progress-chart` — Прогресс (`ProgressScreen.jsx`, `GoalsList.jsx`, графики);
   `feed` — Лента (`FeedScreen.jsx`, `ReactionBar.jsx`, `FeedPrBadge.jsx`); `rating` — рейтинг в Ленте
   (`DisciplineLeaderboard.jsx`, `RivalryCard.jsx`); `run` — подход бега в тренировке (`ExerciseCard.jsx`,
   `TimeInput.jsx`); `achievements` — Достижения (`AchievementsScreen.jsx`); `login` — вход на новом
   телефоне (`LoginScreen.jsx`, `AppMark.jsx`); `join-form` — форма «Запросить доступ» (`JoinRequestForm.jsx`); `join-pending` — заявка «Запросить доступ» ждет
   ответа (`LoginScreen.jsx`, карточка `.join-status`). Общее для всех кадров (шапка, таббар, `index.css`-токены, акцент) —
   визуально заметная правка → переснять все. Сценарий и данные съемки — `scripts/readme-shots.mjs`;
   новый экран в README — добавить его туда же. Скрипт упал на «подмена не нашла строку» — поправить
   `PATCHES` в нем, а не снимать с «нет сети». В результате задачи перечислить, какие кадры пересняты.
5. **Решить, выкатывать ли друзьям.** С 03.08.2026 пуш в `main`
   их приложение НЕ меняет: `deploy.yml` публикует Pages только по тегу `v*`. Поэтому для задачи,
   меняющей продукт, в результате явно указать одно из двух — «выкатываем, тег `vX.Y.Z`» или
   «копим в `main`, тег не двигаем». Номер тега БРАТЬ ИЗ `package.json`, а не набирать руками —
   иначе тег и версия внизу «Профиля» разъедутся:
   `$v = (Get-Content package.json -Raw | ConvertFrom-Json).version; git tag "v$v"; git push origin "v$v"`.
   Откат — `workflow_dispatch` на прошлом теге.
   Пуш «Вышла версия» (Edge `push-update`) с v6.15.0 уходит только при смене `x.y` (`semver.ts`
   `shouldAnnounce`): тег на PATCH выкатывает тихо — друзья получат его при запуске и в «Что нового».
   ⚠️ **Тег обязан двигаться регулярно.** Забытый тег — тихая авария: через полгода у друзей 5.13,
   в `main` 6.x, и слияние уже болезненно. Правило «раз в N недель осознанно», подстраховка —
   недельный алерт в Телеграм по паттерну `tg-digest` (внешний крон), если тег отстал от `main`
   больше чем на N коммитов.
6. Выдать **готовый блок git-команд для Windows PowerShell**. **Первая строка блока** — снять висящий
   lock, если git не запущен (для приватного блока — то же с `.private-git\index.lock`):
   `if ((Test-Path .git\index.lock) -and -not (Get-Process git -ErrorAction SilentlyContinue)) { Remove-Item .git\index.lock }`.
   Тег в блок коммита НЕ включать: только отдельной командой после успешного коммита (и наката сервера,
   если он нужен) — иначе упавший `git add`/`commit` молча оставляет тег на прошлом коммите.
   Дальше: `git add` только относящихся к задаче
   отслеживаемых файлов (включая `package.json` при бампе) → `git commit -m "..."` в стиле
   репозитория (`feat(scope): …`, `fix(...)`, `docs: …`, по-русски, **одна короткая строка** без
   развёрнутого тела — подробности и так в «Логе проходов») → `git push`. Коммит и пуш выполняет
   пользователь.
   - Текст после `type(scope):` формулировать как **конкретный результат/состояние**, по-человечески
     и по-разработчески: `feat(workout): итоги тренировки с рекордами и целями`,
     `fix(home): тёмные кнопки тренировочного ритма`. Не писать как пункт TODO с канцелярским
     инфинитивом (`добавить…`, `сделать…`, `исправить…`) и не использовать расплывчатые
     формулировки вроде «улучшения»/«разные правки».
   - **Накопление правок (30.09.2026):** если предыдущий выданный блок еще НЕ закоммичен (сверять `git log`
     в рабочей папке), новый блок собирает ВСЕ незакоммиченные правки этой серии — прошлые и новые — в один
     `git add`/коммит, версия — одна, по последнему бампу. Не выдавать блок только на последнюю правку.
   - **CI в контейнере Playwright (30.09.2026):** `deploy.yml` и `test.yml` идут в образе
     `mcr.microsoft.com/playwright:vX.Y.Z-noble`, его тег = версия `@playwright/test` из `package-lock.json`.
     Обновил пакет — обнови тег образа И версию в шаге «Версия Playwright совпадает с образом» (строка `v !== 'X.Y.Z'`) в ОБОИХ файлах (шаг «Версия Playwright…» в CI упадет с подсказкой).
   - **Git-ignored файлы в `git add` не включать.** Точный набор определять по `.gitignore` и
     `git status`, не по захардкоженному списку каталогов.
   - **Приватный репозиторий — ВТОРОЙ блок команд (правило пользователя, 01.10.2026).** Если задача
     меняла хоть что-то в `docs/` или `supabase/`, кроме блока для публичного репо выдать отдельный
     блок для приватного (`.private-git`, `kachalka-private`, см. `docs/guides/приватный-репо.md`):
     `[Console]::InputEncoding = [Text.Encoding]::UTF8` (иначе PowerShell съедает заглавную кириллицу
     в сообщении коммита), функция `pgit` с `--git-dir=C:\AI_proj\kachalka-app\.private-git
     --work-tree=C:\AI_proj\kachalka-app`, затем `pgit add -f <конкретные файлы>` → `pgit commit -m
     "..."` → `pgit push`. `-f` обязателен (публичный `.gitignore` скрывает эти папки). Не добавлять
     `supabase/.temp/` и чужие неотслеживаемые папки. Без этого блока задача с правкой доков/SQL не
     считается сданной: правки остаются только на диске.

---

## Стиль

UI и тексты — на русском. Тёмная тема, цвета только через CSS-переменные в `src/index.css`.
Мобайл-first, зоны тапа ≥44px, действия оптимистичные (показать сразу, откатить при ошибке).
