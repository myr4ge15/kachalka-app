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

// История без удалённых, новейшее сверху (по performed_at, тай-брейк created_at,
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
// упражнения остаётся на месте вызова (у sync — {id,name:'—'}, у repo — undefined).
// NB: лента (feed.rowToItem) НЕ здесь — у неё намеренно ПЛОСКАЯ усечённая форма
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
