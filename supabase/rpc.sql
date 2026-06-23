-- ============================================================================
-- Транзакционные RPC для сохранения тренировки одним запросом.
-- Выполнить в Supabase: SQL Editor → New query → вставить → Run.
-- (После schema.sql и seed.sql. Можно перезапускать — create or replace.)
--
-- Зачем: раньше клиент делал 3 последовательных запроса (workouts →
-- workout_exercises → sets). На медленной сети / при «пробуждении» проекта
-- любой из них мог упасть по таймауту уже ПОСЛЕ коммита первого — в базе
-- оставалась пустая тренировка-сирота. Здесь всё идёт одним round-trip и
-- атомарно: либо вся тренировка целиком, либо ничего.
-- ============================================================================

-- p_entries — JSON-массив вида:
--   [ { "exercise_id": "<uuid>", "sets": [ { "weight": 20, "reps": 10 }, ... ] }, ... ]

-- ----------------------------------------------------------------------------
-- Создать новую тренировку со всем составом. Возвращает id тренировки.
-- ----------------------------------------------------------------------------
create or replace function save_workout(p_user_id uuid, p_entries jsonb)
returns uuid
language plpgsql
as $$
declare
  v_workout_id uuid;
  v_entry      jsonb;
  v_set        jsonb;
  v_wex_id     uuid;
  v_pos        int := 0;
  v_setnum     int;
begin
  insert into workouts(user_id) values (p_user_id) returning id into v_workout_id;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    insert into workout_exercises(workout_id, exercise_id, position)
    values (v_workout_id, (v_entry->>'exercise_id')::uuid, v_pos)
    returning id into v_wex_id;

    v_setnum := 0;
    for v_set in select * from jsonb_array_elements(v_entry->'sets')
    loop
      v_setnum := v_setnum + 1;
      insert into sets(workout_exercise_id, set_number, weight, reps)
      values (
        v_wex_id,
        v_setnum,
        (v_set->>'weight')::numeric,
        (v_set->>'reps')::int
      );
    end loop;

    v_pos := v_pos + 1;
  end loop;

  return v_workout_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Переписать состав существующей тренировки (режим правки в Истории).
-- Старые workout_exercises удаляются каскадом вместе с их sets, затем
-- состав вставляется заново. Возвращает id тренировки.
-- ----------------------------------------------------------------------------
create or replace function replace_workout(p_workout_id uuid, p_entries jsonb)
returns uuid
language plpgsql
as $$
declare
  v_entry  jsonb;
  v_set    jsonb;
  v_wex_id uuid;
  v_pos    int := 0;
  v_setnum int;
begin
  delete from workout_exercises where workout_id = p_workout_id;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    insert into workout_exercises(workout_id, exercise_id, position)
    values (p_workout_id, (v_entry->>'exercise_id')::uuid, v_pos)
    returning id into v_wex_id;

    v_setnum := 0;
    for v_set in select * from jsonb_array_elements(v_entry->'sets')
    loop
      v_setnum := v_setnum + 1;
      insert into sets(workout_exercise_id, set_number, weight, reps)
      values (
        v_wex_id,
        v_setnum,
        (v_set->>'weight')::numeric,
        (v_set->>'reps')::int
      );
    end loop;

    v_pos := v_pos + 1;
  end loop;

  return p_workout_id;
end;
$$;
