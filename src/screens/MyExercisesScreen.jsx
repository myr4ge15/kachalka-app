import { useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getExercises, updateExercise } from '../db/repo.js'
import { catalogGroups } from '../lib/exerciseCatalog.js'
import CardsSkeleton from '../components/ui/CardsSkeleton.jsx'
import BackButton from '../components/ui/BackButton.jsx'
import ExerciseCatalog from '../components/exercises/ExerciseCatalog.jsx'
import ExerciseEditForm from '../components/exercises/ExerciseEditForm.jsx'

// Экран «Каталог упражнений»: ВЕСЬ справочник тремя разделами — «Добавил я»,
// «Добавили другие» (кастомные, по owner_id) и «Базовые» (глобальные, is_custom =
// false: сидовый справочник плюс легаси, у которого автора найти не удалось).
//
// Именно «Базовые», а не «Общие», по двум причинам: (1) рядом с «Добавили другие»
// «общее» читается как синоним «не мое» — разница между «завел кто-то из круга» и
// «было в приложении» из заголовков не следует; (2) «Общие» в приложении уже
// занято — так называются расшаренные кругу ШАБЛОНЫ (TemplatesScreen,
// TemplatePicker), и одно слово в двух смыслах путало бы сильнее, чем помогало.
//
// Раньше экран назывался «Мои упражнения» и показывал только кастомные под
// заголовком «упражнения, добавленные вами»: колонки владельца в базе не
// существовало, и у двух разных людей списки совпадали до строки. Владелец
// появился в v5.14.0 (supabase/exercise-owner.sql), и вместе с ним — честное
// название. Глобальные показываем здесь же, потому что каталог, в котором нет
// половины справочника, каталогом не является; правит их админ, поэтому они
// только для чтения (canEditExercise, то же правило стоит и в RLS).
//
// С 23.10.2026 список и форма — общие с Админкой (components/exercises/ExerciseCatalog.jsx и
// ExerciseEditForm.jsx); здесь — только данные и сохранение своих через очередь синка (repo).
//
// Пропсы: user (нужен для owner_id), onBack().
export default function MyExercisesScreen({ user, onBack }) {
  // Весь справочник без скрытых админкой — тот же источник, что у пикера.
  const list = useLiveQuery(() => getExercises(), [])
  const loading = list === undefined
  const [editing, setEditing] = useState(null) // редактируемое упражнение (null → список)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const groups = useMemo(() => catalogGroups(list), [list])

  function close() { setEditing(null); setError(null) }
  async function save(f) {
    setBusy(true)
    setError(null)
    try {
      await updateExercise({
        id: editing.id, name: f.name, muscle_group: f.muscle_group, metric: f.metric,
        submuscle: f.submuscle, secondary: f.secondary, editor_id: user?.id,
      })
      close()
    } catch (err) {
      setError('Не удалось сохранить: ' + (err?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="screen">
        <div className="admin-head">
          <BackButton onClick={close} />
          <h2 className="admin-title">Упражнение</h2>
        </div>
        <ExerciseEditForm ex={editing} groups={groups} busy={busy} error={error} onCancel={close} onSubmit={save} />
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="admin-head">
        <BackButton onClick={onBack} />
        <h2 className="admin-title">Каталог упражнений</h2>
      </div>

      {loading ? (
        <CardsSkeleton cards={4} />
      ) : list.length === 0 ? (
        <p className="muted empty">
          Справочник пуст. Свое упражнение можно создать при добавлении упражнения
          в тренировку («Добавить свое упражнение»).
        </p>
      ) : (
        <>
          <p className="muted sub">
            Справочник один на всех: править можно свои упражнения, и изменения
            увидят все.
          </p>
          <ExerciseCatalog list={list} userId={user?.id} onEdit={setEditing} />
        </>
      )}
    </div>
  )
}
