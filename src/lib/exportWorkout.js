// ============================================================================
// Экспорт тренировок в JSON. Чистые функции (cleanWorkoutForExport/buildExport/
// exportFilename) — без DOM, тестируются в node. downloadJson/exportWorkouts —
// браузерные обертки (Blob + <a download>), в node не зовутся.
//
// Снимок намеренно «человекочитаемый» и без служебных полей синка
// (_dirty/_deleted/user_id/updated_at): отдаем дату, упражнения (с метрикой) и
// подходы {weight, reps} как есть — так выгрузку легко открыть/перенести.
// ============================================================================
import { localYmd } from './calendar.js'
import { exerciseMetric } from './metric.js'

// Один подход → чистый {weight, reps}.
function cleanSet(s) {
  return { weight: Number(s?.weight) || 0, reps: Number(s?.reps) || 0 }
}

// Одна тренировка → экспортный вид без внутренних флагов.
export function cleanWorkoutForExport(w) {
  return {
    id: w?.id ?? null,
    performed_at: w?.performed_at ?? null,
    created_at: w?.created_at ?? null,
    entries: (w?.entries ?? []).map((e) => ({
      exercise: {
        id: e.exercise?.id ?? e.exercise_id ?? null,
        name: e.exercise?.name ?? '—',
        muscle_group: e.exercise?.muscle_group ?? null,
        metric: exerciseMetric(e.exercise),
      },
      sets: (e.sets ?? []).map(cleanSet),
    })),
  }
}

// Снимок для выгрузки: конверт с метаданными + массив тренировок. Принимает
// одну тренировку или массив.
export function buildExport(workouts, appVersion = 'dev', now = new Date()) {
  const list = Array.isArray(workouts) ? workouts : [workouts]
  const at = now instanceof Date ? now : new Date(now)
  return {
    app: 'Журнал тренировок',
    schema: 'workouts-export/v1',
    app_version: appVersion,
    exported_at: Number.isNaN(at.getTime()) ? null : at.toISOString(),
    count: list.length,
    workouts: list.map(cleanWorkoutForExport),
  }
}

// YYYY-MM-DD из даты/ISO ('' если не распарсилось).
function ymd(d) {
  const t = d instanceof Date ? d : new Date(d)
  return localYmd(t) // местный день: ночью UTC-дата — еще «вчера»
}

// Имя файла: одна тренировка → workout-YYYY-MM-DD.json (по ее дате),
// несколько → workouts-N-YYYY-MM-DD.json (N штук, дата выгрузки).
export function exportFilename(workouts, now = new Date()) {
  const list = Array.isArray(workouts) ? workouts : [workouts]
  if (list.length === 1) {
    return `workout-${ymd(list[0]?.performed_at) || ymd(now) || 'export'}.json`
  }
  return `workouts-${list.length}-${ymd(now) || 'export'}.json`
}

// iPhone «на экране Домой» (fb_6fbbaeac, 27.10.2026): скачивание по ссылке открывает файл в системном
// просмотрщике поверх PWA, и после закрытия приложение остается в рамке браузера (адрес, ✕) до
// перезапуска. Там отдаем файл листу «Поделиться» → «Сохранить в Файлы»; в браузере — ссылка, как было.
export function shouldShareFile(file, nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav || nav.standalone !== true || typeof nav.share !== 'function') return false
  try { return nav.canShare ? nav.canShare({ files: [file] }) : false } catch { return false }
}

// Браузерная выгрузка: сериализуем снимок и кликаем по временной ссылке (на iPhone «на экране Домой» —
// лист «Поделиться»). Промис: 'downloaded' | 'shared' | 'cancelled' (закрыли лист, ничего не сохранив).
// Путь со ссылкой — синхронный: файл уходит в том же тапе.
export function downloadJson(obj, filename) {
  const json = JSON.stringify(obj, null, 2)
  if (typeof File === 'function') {
    const file = new File([json], filename, { type: 'application/json' })
    if (shouldShareFile(file)) return shareFile(file, json, filename)
  }
  saveByLink(json, filename)
  return Promise.resolve('downloaded')
}

async function shareFile(file, json, filename) {
  try {
    await navigator.share({ files: [file] })
    return 'shared'
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled'
    saveByLink(json, filename) // лист не открылся (нет жеста, запрет) — хоть так
    return 'downloaded'
  }
}

function saveByLink(json, filename) {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Удобная обертка: собрать снимок и сразу скачать (одна тренировка или массив).
export function exportWorkouts(workouts, appVersion = 'dev', now = new Date()) {
  const list = Array.isArray(workouts) ? workouts : [workouts]
  if (list.length === 0) return
  return downloadJson(buildExport(list, appVersion, now), exportFilename(list, now))
}
