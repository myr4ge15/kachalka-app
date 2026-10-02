import { lazy, useState } from 'react'

// Ленивый экран с префетчем, который РЕАЛЬНО убирает заглушку.
//
// Голый React.lazy узнает о загрузке модуля только от собственного вызова фабрики
// при первом рендере: даже если чанк давно подтянут префетчем, первый рендер все
// равно получает новый pending-промис import() и уходит в Suspense. А React 19
// держит однажды показанный фолбэк не меньше ~300 мс (throttle раскрытия
// Suspense) — отсюда «пустой экран → скелетон → контент» при первом заходе на
// каждую вкладку после холодного старта, хотя все уже в памяти. Повторный заход
// мгновенный: lazy к тому моменту уже resolved.
//
// Здесь preload() и lazy делят ОДИН промис, а готовый компонент запоминается:
// после префетча экран рендерится напрямую, минуя lazy и Suspense. Упавшая
// загрузка (сеть при холодном кэше) промис сбрасывает — следующая попытка
// повторит import, а не залипнет на ошибке.
const RETRY_AFTER_MS = 300

export function lazyScreen(factory) {
  let Loaded = null
  let pending = null
  const preload = () => {
    pending ??= factory().then(
      (mod) => { Loaded = mod.default; return mod },
      (err) => { pending = null; throw err }
    )
    return pending
  }
  // React.lazy запоминает ОТКЛОНЕННЫЙ промис навсегда: сброса `pending` мало —
  // тот же объект lazy при повторном монтировании («Попробовать снова» в
  // ErrorBoundary) снова бросал старую ошибку, и вкладка была мертва до
  // перезагрузки. Поэтому после сбоя заводим НОВЫЙ lazy — но не сразу: сразу после
  // отказа React перерисовывает то же поддерево, и подмена lazy в этот момент
  // запустила бы тихий повтор по кругу вместо экрана ошибки. Упавший lazy живет
  // RETRY_AFTER_MS (успевает отдать ошибку в ErrorBoundary), новый создается уже
  // при следующем монтировании — по нажатию «Попробовать снова».
  let Lazy = null
  let failedAt = 0
  const makeLazy = () => lazy(() => preload().catch((err) => { failedAt = Date.now(); throw err }))
  // Выбор фиксируем на жизнь экземпляра: экран, смонтированный через lazy, при
  // догрузке модуля не должен переключиться на Loaded — смена типа элемента
  // перемонтировала бы его с потерей состояния.
  function Screen(props) {
    const [Comp] = useState(() => {
      if (Loaded) return Loaded
      if (!Lazy || (failedAt && Date.now() - failedAt >= RETRY_AFTER_MS)) { failedAt = 0; Lazy = makeLazy() }
      return Lazy
    })
    return <Comp {...props} />
  }
  Screen.preload = preload
  return Screen
}
