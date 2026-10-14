import { normalizeName } from './similar.js'
import { searchExercises } from './exerciseSearch.js'

// Only expand whole phrases; resolve against the supplied visible catalog.
const SYNONYMS = {
  'жим': ['жим лежа', 'жим'],
  'жим лежа': ['жим лежа'],
  'присед': ['присед'],
  'приседания': ['присед'],
  'становая': ['становая тяга'],
  'верхний блок': ['тяга верхнего блока'],
  'нижний блок': ['горизонтальная тяга блока'],
  'бабочка': ['сведения в тренажере бабочка'],
  'брусья': ['отжимания на брусьях'],
  'мостик': ['ягодичный мостик'],
}

export function voiceCandidates(text, exercises) {
  const phrase = normalizeName(text).replace(/^(?:добавь|добавить)(?: упражнение)?\s+/, '')
  if (!phrase) return []
  const queries = SYNONYMS[phrase] ?? [phrase]
  const seen = new Set()
  return queries.flatMap((q) => searchExercises(q, exercises).byName)
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
