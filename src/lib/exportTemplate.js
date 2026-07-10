// ============================================================================
// Экспорт шаблонов тренировок в JSON — по образцу exportWorkout.js. Чистые
// функции (cleanTemplateForExport/buildTemplatesExport/templatesExportFilename)
// — без DOM, тестируются в node; exportTemplates — браузерная обёртка
// (переиспользует downloadJson из exportWorkout.js).
//
// Снимок «человекочитаемый», без служебных полей синка (_dirty/user_id/
// updated_at): имя, видимость, автор (у чужих общих) и упорядоченный состав
// с целевым планом {sets, reps, weight} как есть (легаси без плана → null).
// ============================================================================
import { exerciseMetric } from './metric.js'
import { downloadJson } from './exportWorkout.js'

// Число или null (легаси-упражнения без целевого плана).
function numOrNull(v) {
  return v == null || v === '' ? null : Number(v)
}

// Один шаблон → экспортный вид без внутренних флагов.
export function cleanTemplateForExport(t) {
  return {
    id: t?.id ?? null,
    name: t?.name ?? '—',
    is_public: Boolean(t?.is_public),
    // У чужих общих шаблонов сохраняем автора; у своих поля нет в доке → null.
    author: t?.author_name ?? null,
    exercises: [...(t?.exercises ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((e) => ({
        exercise: {
          id: e.exercise?.id ?? e.exercise_id ?? null,
          name: e.exercise?.name ?? '—',
          muscle_group: e.exercise?.muscle_group ?? null,
          metric: exerciseMetric(e.exercise),
        },
        // Целевой план: подходы × повторы (у time — секунды) × вес.
        sets: numOrNull(e.sets),
        reps: numOrNull(e.reps),
        weight: numOrNull(e.weight),
      })),
  }
}

// Снимок для выгрузки: конверт с метаданными + массив шаблонов. Принимает
// один шаблон или массив.
export function buildTemplatesExport(templates, appVersion = 'dev', now = new Date()) {
  const list = Array.isArray(templates) ? templates : [templates]
  const at = now instanceof Date ? now : new Date(now)
  return {
    app: 'Журнал тренировок',
    schema: 'templates-export/v1',
    app_version: appVersion,
    exported_at: Number.isNaN(at.getTime()) ? null : at.toISOString(),
    count: list.length,
    templates: list.map(cleanTemplateForExport),
  }
}

// YYYY-MM-DD из даты/ISO ('' если не распарсилось).
function ymd(d) {
  const t = d instanceof Date ? d : new Date(d)
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10)
}

// Имя файла: один шаблон → template-YYYY-MM-DD.json, несколько →
// templates-N-YYYY-MM-DD.json (дата выгрузки — у шаблонов нет «своей» даты).
export function templatesExportFilename(templates, now = new Date()) {
  const list = Array.isArray(templates) ? templates : [templates]
  const day = ymd(now) || 'export'
  return list.length === 1 ? `template-${day}.json` : `templates-${list.length}-${day}.json`
}

// Удобная обёртка: собрать снимок и сразу скачать (один шаблон или массив).
export function exportTemplates(templates, appVersion = 'dev', now = new Date()) {
  const list = Array.isArray(templates) ? templates : [templates]
  if (list.length === 0) return
  downloadJson(buildTemplatesExport(list, appVersion, now), templatesExportFilename(list, now))
}
