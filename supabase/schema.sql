-- ============================================================================
-- Журнал тренировок — схема БД (первый проход MVP)
-- Выполнить в Supabase: SQL Editor → New query → вставить → Run.
-- Затем выполнить seed.sql для стартового справочника и пользователей.
-- ============================================================================

-- Чистый старт (удобно при пересоздании во время разработки)
drop table if exists sets cascade;
drop table if exists workout_exercises cascade;
drop table if exists workouts cascade;
drop table if exists exercises cascade;
drop table if exists users cascade;

-- ----------------------------------------------------------------------------
-- Пользователи. PIN хранится только в виде SHA-256 хэша.
-- Вход (выбор пользователя + PIN) проверяется на клиенте в первом проходе.
-- ----------------------------------------------------------------------------
create table users (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  pin_hash   text not null,                -- SHA-256(pin) в hex
  role       text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Справочник упражнений (предзаполнен, см. Приложение A в ТЗ).
-- is_bench_lift = true помечает «Жим лёжа со штангой» — основа для графика/лидерборда.
-- ----------------------------------------------------------------------------
create table exercises (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  muscle_group text,                        -- грудь, спина, ноги, плечи, бицепс, трицепс, пресс
  is_custom    boolean not null default false,
  is_bench_lift boolean not null default false,
  unit         text not null default 'kg',
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Тренировка
-- ----------------------------------------------------------------------------
create table workouts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  performed_at timestamptz not null default now(),
  title        text,
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Выполненное упражнение в рамках тренировки
-- ----------------------------------------------------------------------------
create table workout_exercises (
  id          uuid primary key default gen_random_uuid(),
  workout_id  uuid not null references workouts(id) on delete cascade,
  exercise_id uuid not null references exercises(id),
  position    int not null default 0
);

-- ----------------------------------------------------------------------------
-- Подход: вес × повторы
-- ----------------------------------------------------------------------------
create table sets (
  id                  uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references workout_exercises(id) on delete cascade,
  set_number          int not null,
  weight              numeric(6,2) not null check (weight >= 0),
  reps                int not null check (reps > 0)
);

-- Индексы под основные выборки
create index idx_workouts_user        on workouts(user_id, performed_at);
create index idx_we_workout           on workout_exercises(workout_id);
create index idx_we_exercise          on workout_exercises(exercise_id);
create index idx_sets_we              on sets(workout_exercise_id);

-- ----------------------------------------------------------------------------
-- RLS (первый проход)
-- Авторизация пока по PIN на клиенте, Supabase Auth не используется, поэтому
-- доступ идёт под ролью anon. Для закрытого круга из ~5 человек включаем RLS
-- с разрешающими политиками для anon. ЭТО ВРЕМЕННО: на следующем проходе
-- переносим проверку PIN в Edge Function / переходим на Supabase Auth и
-- ужесточаем политики (свои данные — пишу, чужие — только читаю).
-- ----------------------------------------------------------------------------
alter table users             enable row level security;
alter table exercises         enable row level security;
alter table workouts          enable row level security;
alter table workout_exercises enable row level security;
alter table sets              enable row level security;

-- users: читать имена/хэши можно (нужно для экрана входа), запись — тоже открыта
create policy users_read   on users for select using (true);
create policy users_write  on users for all    using (true) with check (true);

create policy exercises_read  on exercises for select using (true);
create policy exercises_write on exercises for all    using (true) with check (true);

create policy workouts_all  on workouts          for all using (true) with check (true);
create policy we_all        on workout_exercises for all using (true) with check (true);
create policy sets_all      on sets              for all using (true) with check (true);
