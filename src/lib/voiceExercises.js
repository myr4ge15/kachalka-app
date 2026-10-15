import { normalizeName } from './similar.js'
import { searchExercises } from './exerciseSearch.js'
import { VOICE_ALIASES, VOICE_QUERIES } from './voiceAliases.js'
import { parseVoiceCommand } from './voiceCommand.js'

// Apply the same limited morphology to speech and catalog names, not OCR.
function voiceWords(text) {
  return normalizeName(text).split(' ').filter((w) => !['на', 'в', 'с', 'со', 'для'].includes(w))
    .map((word) => {
      if (/^штанг(?:а|и|у|ой|ою|е)$/.test(word)) return 'штанг'
      if (/^гантел(?:ь|и|ей|ями|ью|ям|ях)$/.test(word)) return 'гантел'
      if (/^скам(?:ья|ьи|ье|ью|ей|ейка|ейки|ейке|ейку)$/.test(word)) return 'скам'
      if (/^тренажер(?:а|е|ы|ов|ом)?$/.test(word)) return 'тренажер'
      if (/^(?:сгибания|сгибание)$/.test(word)) return 'сгибани'
      if (/^(?:разгибания|разгибание)$/.test(word)) return 'разгибани'
      return word
    }).join(' ')
}

// Название из фразы: без командных слов и без хвоста про подход
// («добавь жим лежа 60 на 12» → «жим лежа»), см. lib/voiceCommand.js.
export function voiceQuery(text) {
  return normalizeName(parseVoiceCommand(text).query)
}

export function voiceCandidates(text, exercises) {
  const phrase = voiceQuery(text)
  if (!phrase) return []
  const aliases = VOICE_ALIASES.filter((entry) => entry.aliases.includes(phrase))
  const named = new Set(aliases.flatMap((entry) => entry.names.map(normalizeName)))
  const exact = [
    ...exercises.filter((ex) => normalizeName(ex.name) === phrase),
    ...exercises.filter((ex) => normalizeName(ex.name) !== phrase && named.has(normalizeName(ex.name))),
  ]
  // An alias never creates an exercise or silently substitutes a missing variant.
  if (aliases.length && !VOICE_QUERIES[phrase]) return exact
  const queries = VOICE_QUERIES[phrase] ?? [phrase]
  const searchable = exercises.map((ex) => ({ ...ex, name: voiceWords(ex.name), original: ex }))
  const seen = new Set()
  return [...exact, ...queries.map(voiceWords).filter(Boolean)
    .flatMap((q) => searchExercises(q, searchable).byName.map((ex) => ex.original))]
    .filter((ex) => !seen.has(ex.id) && seen.add(ex.id))
}

// Лучший из вариантов распознавателя: первый, у которого нашлись упражнения
// («мостики» мимо, «мостик» — в справочнике). Нет ни у кого — первый, как есть.
export function bestVoicePhrase(phrases, exercises) {
  for (const phrase of phrases) {
    const candidates = voiceCandidates(phrase, exercises)
    if (candidates.length) return { phrase, candidates }
  }
  return { phrase: phrases[0] ?? '', candidates: [] }
}

// Текст ошибки распознавания. `manual` — запасной путь экрана: в пикере это поиск,
// в карточке упражнения — ввод в строке подхода.
export function speechError(code, manual = 'используй поиск') {
  const Manual = manual[0].toUpperCase() + manual.slice(1)
  return ({
    'not-allowed': 'Разреши доступ к микрофону в настройках браузера.',
    'service-not-allowed': `Распознавание недоступно в этом браузере. ${Manual}.`,
    'audio-capture': 'Микрофон недоступен. Проверь подключение и разрешения.',
    'network': 'Ошибка сети. Проверь интернет и попробуй еще раз.',
    'no-speech': 'Речь не распознана. Попробуй еще раз.',
    'language-not-supported': `Русский язык недоступен для распознавания. ${Manual}.`,
    'timeout': `Время записи истекло. Повтори или ${manual}.`,
    'start': `Не удалось включить микрофон. ${Manual} или повтори.`,
  })[code] ?? `Не удалось распознать речь. Повтори или ${manual}.`
}
