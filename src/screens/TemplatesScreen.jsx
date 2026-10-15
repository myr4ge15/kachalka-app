import { useState } from 'react'
import TemplateList from '../components/templates/TemplateList.jsx'
import TemplateEditor from '../components/templates/TemplateEditor.jsx'

// Экран шаблонов: список ↔ редактор (одно внутреннее состояние editing).
//   editing === null  → список шаблонов
//   editing === 'new' → создание нового
//   editing === <id>  → правка существующего
// Список и редактор — components/templates/TemplateList.jsx и TemplateEditor.jsx
// (аудит 14.10: экран был 496 строк с тремя компонентами в одном файле).
export default function TemplatesScreen({ user, onBack }) {
  const [editing, setEditing] = useState(null)

  if (editing !== null) {
    return (
      <TemplateEditor
        user={user}
        templateId={editing === 'new' ? null : editing}
        onBack={() => setEditing(null)}
      />
    )
  }

  return <TemplateList user={user} onBack={onBack} onOpen={setEditing} />
}
