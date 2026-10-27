import { useState } from 'react'
import SheetDialog from '../ui/SheetDialog.jsx'
import HoldButton from '../ui/HoldButton.jsx'
import { showToast } from '../ui/Toast.jsx'
import DateField from '../ui/DateField.jsx'
import { localYmd, toDate } from '../../lib/calendar.js'
import {
  BODY_FIELDS, WEIGHT_MIN, WEIGHT_MAX, NOTE_MAX, parseWeight, parseCm, fmtBodyDate,
} from '../../lib/body.js'
import { saveBodyEntry, setBodyPrefs } from '../../db/body.js'
import { useAliveRef } from '../../hooks/useAliveRef.js'

// Лист «Записать» — вес ИЛИ замеры (fb_6114e96f: один лист на оба дублировал вкладки и был
// перегружен). Свое состояние формы; экран только открывает и закрывает.
// Пропсы: userId, body (нормализованный документ), mode — 'weight' | 'measures', entry — правка
// записи (тогда видны оба раздела, если в ней есть и то, и другое), last — прошлое взвешивание, onClose().
// Замеры: у каждого обхвата тумблер прямо в строке — выключенный обхват виден, но поле неактивно.
// «Скрыть цифры»: новая запись НЕ подставляет прошлый вес и не пишет «Прошлый раз — …».
// «−/+» по пустому полю начинают с прошлого веса (или 70 кг, если его нет или цифры скрыты).
const START_WEIGHT = 70
const clampW = (n) => String(Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, Math.round(n * 10) / 10)))

export default function BodyEntrySheet({ userId, body, mode = 'weight', entry = null, last = null, onClose }) {
  const aliveRef = useAliveRef()
  const today = localYmd(new Date())
  const hide = body.hide && !entry
  const hasCm = (e) => BODY_FIELDS.some((f) => e?.[f.id] != null)
  const showWeight = entry ? entry.weight != null || !hasCm(entry) : mode === 'weight'
  const showCms = entry ? hasCm(entry) : mode === 'measures'
  // Время суток DateField держит сам (ISO); в запись идет только местный день.
  const [dateIso, setDateIso] = useState(() => toDate(entry?.date ?? today).toISOString())
  const date = localYmd(dateIso)
  const [weight, setWeight] = useState(() => {
    if (entry) return entry.weight != null ? String(entry.weight) : ''
    if (hide) return ''
    return last?.weight != null ? String(last.weight) : ''
  })
  const [cms, setCms] = useState(() => Object.fromEntries(BODY_FIELDS.map((f) => [f.id, entry?.[f.id] != null ? String(entry[f.id]) : ''])))
  const [note, setNote] = useState(entry?.note ?? '')
  const [busy, setBusy] = useState(false)

  const w = showWeight ? parseWeight(weight) : null
  const on = (id) => body.fields.includes(id)
  const anyCm = showCms && BODY_FIELDS.some((f) => on(f.id) && parseCm(cms[f.id]) != null)
  const weightBad = showWeight && weight.trim() !== '' && w == null
  const canSave = !busy && date && date <= today && !weightBad && (w != null || anyCm)

  const bump = (d) => setWeight((v) => {
    const n = parseWeight(v)
    if (n != null) return clampW(n + d)
    return clampW(!hide && last?.weight != null ? last.weight : START_WEIGHT)
  })

  async function toggleField(id) {
    const next = on(id) ? body.fields.filter((f) => f !== id) : [...body.fields, id]
    await setBodyPrefs(userId, { fields: next })
  }

  async function save() {
    if (!canSave) return
    setBusy(true)
    try {
      const rec = { id: entry?.id, date, note }
      if (w != null) rec.weight = w
      else if (entry?.weight != null && !showWeight) rec.weight = entry.weight
      for (const f of BODY_FIELDS) {
        if (showCms && on(f.id)) rec[f.id] = cms[f.id]
        // Обхват, который человек перестал вести, у старой записи не стираем молча.
        else if (entry?.[f.id] != null) rec[f.id] = entry[f.id]
      }
      const id = await saveBodyEntry(userId, rec)
      if (!id) throw new Error('нечего записать')
      onClose?.()
    } catch (e) {
      showToast({ icon: 'alert', title: 'Не удалось записать', sub: String(e?.message ?? e) })
      if (aliveRef.current) setBusy(false)
    }
  }

  const title = entry ? 'Правка записи' : mode === 'measures' ? 'Замеры' : 'Вес'
  return (
    <SheetDialog title={title} actionLabel="отмена" onDismiss={onClose} swipeDown className="body-sheet">
      <div className="sheet-scroll body-sheet-scroll">
        <DateField performedAt={dateIso} onChange={setDateIso} label="Дата записи" />

        {showWeight && (
          <div className="body-field">
            <span className="body-field-lbl" id="body-w-lbl">Вес, кг</span>
            <div className="stepper body-stepper">
              <HoldButton aria-label="Вес меньше на 0.1" onTrigger={() => bump(-0.1)}>−</HoldButton>
              <input aria-labelledby="body-w-lbl" inputMode="decimal" autoComplete="off" value={weight} placeholder="кг"
                onChange={(e) => setWeight(e.target.value)} aria-invalid={weightBad || undefined} />
              <HoldButton aria-label="Вес больше на 0.1" onTrigger={() => bump(0.1)}>+</HoldButton>
            </div>
            {weightBad && <p className="body-hint">Вес — от {WEIGHT_MIN} до {WEIGHT_MAX} кг.</p>}
            {!entry && !hide && last?.weight != null && (
              <p className="body-hint">Прошлый раз — {last.weight} кг, {fmtBodyDate(last.date, today)}</p>
            )}
          </div>
        )}

        {showCms && (
          <div className="body-field">
            <span className="body-field-lbl">Обхваты, см · включи те, что ведешь</span>
            <ul className="body-cms">
              {BODY_FIELDS.map((f) => (
                <li key={f.id} className={`body-cm${on(f.id) ? '' : ' is-off'}`}>
                  <button type="button" role="switch" aria-checked={on(f.id)} aria-label={`Вести: ${f.label}`}
                    className="body-cm-switch" onClick={() => toggleField(f.id)}>
                    <span className={'toggle-pill' + (on(f.id) ? ' on' : '')} aria-hidden="true"><span className="toggle-knob" /></span>
                  </button>
                  <span className="body-cm-lbl">{f.label}</span>
                  <input className="body-input" inputMode="decimal" autoComplete="off" aria-label={`${f.label}, см`}
                    disabled={!on(f.id)} value={cms[f.id]} placeholder={on(f.id) ? 'см' : '—'}
                    onChange={(e) => setCms((c) => ({ ...c, [f.id]: e.target.value }))} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="body-field body-note">
          <span className="body-field-lbl">Заметка</span>
          <input className="body-input" value={note} maxLength={NOTE_MAX} autoComplete="off" placeholder="необязательно"
            onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      <div className="btn-row body-sheet-actions">
        <button type="button" className="btn primary" disabled={!canSave} onClick={save}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
      </div>
    </SheetDialog>
  )
}
