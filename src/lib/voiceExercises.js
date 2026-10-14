import { normalizeName } from './similar.js'
import { searchExercises } from './exerciseSearch.js'
import { VOICE_ALIASES } from './voiceAliases.js'

// Only expand whole phrases; resolve against the supplied visible catalog.
const SYNONYMS = {
  'жим': ['жим лежа', 'жим'],
  'жим лежа': ['жим лежа'],
  'жим лежа на скамейке': ['жим лежа'],
  'жим лежа на скамье': ['жим лежа'],
  'присед': ['присед'],
  'приседания': ['присед'],
  'становая': ['становая тяга'],
  'верхний блок': ['тяга верхнего блока'],
  'нижний блок': ['горизонтальная тяга блока', 'нижн блок'],
  'бабочка': ['сведения в тренажере бабочка'],
  'брусья': ['отжимания на брусьях'],
  'мостик': ['ягодичный мостик'],
}

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

export function voiceCandidates(text, exercises) {
  const phrase = normalizeName(text).replace(/^(?:добавь|добавить)(?: упражнение)?\s+/, '')
  if (!phrase) return []
  const aliases = VOICE_ALIASES.filter((entry) => entry.aliases.includes(phrase))
  const named = new Set(aliases.flatMap((entry) => entry.names.map(normalizeName)))
  const exact = [
    ...exercises.filter((ex) => normalizeName(ex.name) === phrase),
    ...exercises.filter((ex) => normalizeName(ex.name) !== phrase && named.has(normalizeName(ex.name))),
  ]
  // An alias never creates an exercise or silently substitutes a missing variant.
  if (aliases.length && !SYNONYMS[phrase]) return exact
  const queries = SYNONYMS[phrase] ?? [phrase]
  const searchable = exercises.map((ex) => ({ ...ex, name: voiceWords(ex.name), original: ex }))
  const seen = new Set()
  return [...exact, ...queries.map(voiceWords).filter(Boolean)
    .flatMap((q) => searchExercises(q, searchable).byName.map((ex) => ex.original))]
    .filter((ex) => !seen.has(ex.id) && seen.add(ex.id))
}

export function speechError(code) {
  return ({
    'not-allowed': 'Разреши доступ к микрофону в настройках браузера.',
    'service-not-allowed': 'Распознавание недоступно в этом браузере. Используй поиск.',
    'audio-capture': 'Микрофон недоступен. Проверь подключение и разрешения.',
    'network': 'Ошибка сети. Проверь интернет и попробуй еще раз.',
    'no-speech': 'Речь не распознана. Попробуй еще раз.',
    'language-not-supported': 'Русский язык недоступен для распознавания. Используй поиск.',
  })[code] ?? 'Не удалось распознать речь. Повтори или используй поиск.'
}
