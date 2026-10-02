// ============================================================================
// Мелкие общие хелперы над `entries` тренировки — чистые, без Dexie/React/сети.
//
// Жили копиями в records.js/insights.js/homeSummary.js/profileStats.js (РЕВЬЮ-
// КОДА-2026-07-13, «Мелкие хелперы entries/дат»). Расхождение семантики метрики
// при правке одной копии — реальный класс багов, поэтому сведены сюда.
//
// NB: `groupOf`/`dayIndex` НАМЕРЕННО НЕ здесь — их копии в freshness.js оправданы
// анти-циклом (freshness не должен импортить insights/homeSummary; см. док в
// freshness.js). `entryName` тоже оставлен по месту: у ленты дефолт '—', у
// records — null, семантика разная.
// ============================================================================
import { normMetric } from './metric.js'
import { cmpIsoDesc } from './cmp.js'

// id упражнения записи: у элементов ленты лежит плоско (e.exercise_id), у
// документов тренировки — во вложенном e.exercise.id.
export const entryExId = (e) => e.exercise_id ?? e.exercise?.id ?? null

// Метрика записи: у ленты плоско (e.metric), у документа тренировки — в
// денормализованном e.exercise.metric. Дефолт 'weight'.
export const entryMetric = (e) => normMetric(e.metric ?? e.exercise?.metric)

// История без удаленных, новейшее сверху (по performed_at, тай-брейк created_at,
// затем id). Тай-брейк по id обязателен: при равных performed_at И created_at
// (две записи в одну секунду) порядок массива недетерминирован → якорь инсайтов
// (buildInsights) и «последняя тренировка»/latestPr в homeSummary флипали между
// прогонами. Паритет с хронологией records.js (там тот же id-добор).
export function sortDesc(workouts) {
  return [...(workouts ?? [])]
    .filter((w) => w && !w._deleted)
    .sort(
      (a, b) =>
        cmpIsoDesc(a.performed_at, b.performed_at) ||
        cmpIsoDesc(a.created_at, b.created_at) ||
        cmpIsoDesc(String(a.id), String(b.id))
    )
}

// Канонический денормализованный снимок упражнения внутри `entries` тренировки/
// шаблона. Раньше этот маппинг был СКОПИРОВАН в 4 местах (sync.rowToDoc/
// templateRowToDoc, repo.cleanEntries/cleanTemplateExercises), и поля начали
// разъезжаться (РЕВЬЮ-КОДА-2026-07-13). Принимает объект упражнения (join с
// сервера или из формы), возвращает единый снимок; фолбэк при ОТСУТСТВИИ
// упражнения остается на месте вызова (у sync — {id,name:'—'}, у repo — undefined).
// NB: лента (feed.rowToItem) НЕ здесь — у нее намеренно ПЛОСКАЯ усеченная форма
// (без вложенного exercise, зато с is_female_lift). metric через normMetric: для
// серверных enum-значений это тождественно прежнему `?? 'weight'`, но заодно
// валидирует форму (repo уже так делал).
export function pickExerciseShape(ex) {
  return {
    id: ex.id,
    name: ex.name,
    muscle_group: ex.muscle_group ?? null,
    submuscle: ex.submuscle ?? null,
    secondary: ex.secondary ?? [],
    is_bench_lift: Boolean(ex.is_bench_lift),
    metric: normMetric(ex.metric),
  }
}

// ── Текущая форма упражнения (РЕВЬЮ-КОДА-2026-10-02, п. 17) ──────────────────
// Почему: тренировка хранит СНИМОК упражнения на момент сохранения, а серверные
// admin_update_exercise/admin_merge_exercise не двигают workouts.updated_at, и
// инкрементальный pull уже скачанные документы не перетягивает. После смены типа
// (weight↔reps↔time) или переименования старые записи бессрочно несут старые
// metric/name. Если брать метрику из снимка каждой записи, значения в разных
// единицах попадают в один максимум: старое 10 кг×8 и новые 12 повторов давали
// «рекорд 12 (было 10)», где 10 — килограммы. Правило: актуальна форма из САМОГО
// СВЕЖЕГО по performed_at снимка упражнения (тай-брейк created_at, затем id — как
// в sortDesc), а подходы в другой единице с ней не сравниваются.

const rawMetricOf = (e) => {
  const raw = e?.metric ?? e?.exercise?.metric
  return raw == null || raw === '' ? null : raw
}

// Карта id упражнения → { id, name, metric, legacy, is_bench_lift, at } по
// самому свежему снимку. metric нормализован; legacy=true — у свежего снимка нет
// явного metric (легаси-запись до PLAN-metrics), вызывающий может сохранить свой
// фолбэк (напр. «Прогресс» решает тип по наличию веса в подходах). Удаленные
// тренировки не учитываются. Работает и с элементами ленты (плоские поля).
export function currentExerciseShapes(workouts) {
  const out = new Map()
  for (const w of sortDesc(workouts)) {
    for (const e of w.entries ?? []) {
      const id = entryExId(e)
      if (!id || out.has(id)) continue
      const raw = rawMetricOf(e)
      out.set(id, {
        id,
        name: e.name ?? e.exercise?.name ?? null,
        metric: normMetric(raw),
        legacy: raw == null,
        is_bench_lift: Boolean(e.is_bench_lift ?? e.exercise?.is_bench_lift),
        at: w.performed_at ?? null,
      })
    }
  }
  return out
}

// В какой единице записаны подходы записи. Явный metric снимка — как есть. У
// легаси-записи без metric (до PLAN-metrics всё писалось как «вес») единицу
// угадываем: если текущий тип упражнения count (reps/time), а внешнего веса в
// подходах нет, это те же повторы/секунды — записи из эпохи «подтягивания с
// weight:0» не выпадают из рекордов и графика. Иначе — 'weight'.
export function entryUnitMetric(e, currentMetric) {
  const raw = rawMetricOf(e)
  if (raw != null) return normMetric(raw)
  const cur = currentMetric == null ? null : normMetric(currentMetric)
  if (cur && cur !== 'weight' && !(e?.sets ?? []).some((s) => Number(s?.weight) > 0)) return cur
  return 'weight'
}

// Сравнима ли запись с текущей формой упражнения (та же единица). Нет формы →
// сравнивать не с чем, считаем сравнимой (старое поведение).
export function isCurrentUnit(e, shape) {
  if (!shape) return true
  return entryUnitMetric(e, shape.metric) === shape.metric
}
