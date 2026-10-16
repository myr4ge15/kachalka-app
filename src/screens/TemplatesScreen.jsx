import { useLayoutEffect, useRef, useState } from 'react'
import TemplateList from '../components/templates/TemplateList.jsx'
import TemplateEditor from '../components/templates/TemplateEditor.jsx'
import { useEdgeSwipeBack } from '../hooks/useEdgeSwipeBack.js'
import { settleScroll } from '../lib/scrollBox.js'

// Экран шаблонов: список ↔ редактор (одно внутреннее состояние editing).
//   editing === null  → список шаблонов
//   editing === 'new' → создание нового
//   editing === <id>  → правка существующего
// Список и редактор — components/templates/TemplateList.jsx и TemplateEditor.jsx
// (аудит 14.10: экран был 496 строк с тремя компонентами в одном файле).
//
// 16.10 (обращения fb_27b0e947, fb_1d1594e6, fb_ae7bdcb1):
//   • свайп назад, как у тренировки: из редактора — к списку, из списка — к «Тренировкам»;
//   • список НЕ размонтируется на время редактора (слой .nav-underlay / hidden): это и
//     подложка свайпа, и возврат на то же место прокрутки — новый экземпляр начинался бы со
//     скелетона, и вернуть позицию было бы некуда.
//   contentRef, swipeOn — скроллер приложения и «свайп доступен» (iOS-PWA, мобайл);
//   underlay — что показать под списком во время свайпа (список «Тренировок»).
export default function TemplatesScreen({ user, onBack, contentRef = null, swipeOn = false, underlay = null }) {
  const [editing, setEditing] = useState(null)
  const listTop = useRef(0)
  const listRef = useRef(null)
  const editorRef = useRef(null)

  function open(id) {
    listTop.current = contentRef?.current?.scrollTop ?? 0
    setEditing(id)
  }
  const back = editing !== null ? () => setEditing(null) : () => onBack?.()

  // Редактор — с верха; список после редактора — на сохраненное место (settleScroll: на iPhone
  // голый scrollTo во время инерции игнорируется).
  useLayoutEffect(() => settleScroll(contentRef?.current, editing !== null ? 0 : listTop.current), [editing, contentRef])

  useEdgeSwipeBack(contentRef, editing !== null ? editorRef : listRef, back, swipeOn)

  const editorOpen = editing !== null
  return (
    <div className="nav-stack">
      {swipeOn && !editorOpen && underlay && (
        <div key="hub" className="nav-layer nav-underlay" inert aria-hidden="true">{underlay}</div>
      )}
      <div key="list" ref={listRef}
        className={'nav-layer ' + (!editorOpen ? 'nav-current' : swipeOn ? 'nav-underlay' : 'nav-hidden')}
        // Под редактором при свайпе список показываем там, где его оставили (useEdgeSwipeBack).
        data-scroll-top={editorOpen ? listTop.current : undefined}
        inert={editorOpen || undefined} aria-hidden={editorOpen || undefined}>
        <TemplateList user={user} onBack={onBack} onOpen={open} />
      </div>
      {editorOpen && (
        <div key="editor" className="nav-layer nav-current" ref={editorRef}>
          <TemplateEditor
            user={user}
            templateId={editing === 'new' ? null : editing}
            onBack={() => setEditing(null)}
          />
        </div>
      )}
    </div>
  )
}
