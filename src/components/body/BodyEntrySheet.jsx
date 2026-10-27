import { useState } from 'react'
import SheetDialog from '../ui/SheetDialog.jsx'
import MenuRow from '../ui/MenuRow.jsx'
import HoldButton from '../ui/HoldButton.jsx'
import { showToast } from '../ui/Toast.jsx'
import DateField from '../ui/DateField.jsx'
import { localYmd, toDate } from '../../lib/calendar.js'
import {
  BODY_FIELDS, WEIGHT_MIN, WEIGHT_MAX, NOTE_MAX, parseWeight, parseCm, fmtBodyDate,
} from '../../lib/body.js'
import { saveBodyEntry, setBodyPrefs } from '../../db/body.js'
import { useAliveRef } from '../../hooks/useAliveRef.js'

// Лист «Записать» (вес и замеры). Свое состояние формы; экран только открывает и закрывает.
// Пропсы: userId, body (нормализованный документ), entry — правка существующей записи (иначе
// новая), focus — 'weight' | 'measures' (с какой вкладки открыли), onClose().
// «Скрыть цифры»: новая запись НЕ подставляет прошлый вес и не пишет «Прошлый раз — …»
// (иначе цифра видна по пути), степпер оживает, когда человек ввел число сам.
const step = (v, d) => {
  const n = parseWeight(v)
  if (n == null) return v
  return String(Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, Math.round((n + d) * 10) / 10)))
}

export default function BodyEntrySheet({ userId, body, entry = null, focus = 'weight', last = null, onClose }) {
  const aliveRef = useAliveRef()
  const today = localYmd(new Date())
  const hide = body.hide && !entry
  // Время суток DateField держит сам (ISO); в запись идет только местный день.
  const [dateIso, setDateIso] = useState(() => toDate(entry?.date ?? today).toISOString())
  const date = localYmd(dateIso)
  const [weight, setWeight] = useState(() => {
    if (entry) return entry.weight != null ? String(entry.weight) : ''
    if (focus === 'measures' || hide) return ''
    return last?.weight != null ? String(last.weight) : ''
  })
  const [cms, setCms] = useState(() => Object.fromEntries(BODY_FIELDS.map((f) => [f.id, entry?.[f.id] != null ? String(entry[f.id]) : ''])))
  const [note, setNote] = useState(entry?.note ?? '')
  const [measuresOpen, setMeasuresOpen] = useState(focus === 'measures' || BODY_FIELDS.some((f) => entry?.[f.id] != null))
  const [pickOpen, setPickOpen] = useState(focus === 'measures' && !body.fields.length)
  const [busy, setBusy] = useState(false)

  const fields = BODY_FIELDS.filter((f) => body.fields.includes(f.id))
  const w = parseWeight(weight)
  const anyCm = fields.some((f) => parseCm(cms[f.id]) != null)
  const weightBad = weight.trim() !== '' && w == null
  const canSave = !busy && date && date <= today && !weightBad && (w != null || anyCm)

  async function toggleField(id) {
    const next = body.fields.includes(id) ? body.fields.filter((f) => f !== id) : [...body.fields, id]
    await setBodyPrefs(userId, { fields: next })
  }

  async function save() {
    if (!canSave) return
    setBusy(true)
    try {
      const rec = { id: entry?.id, date, note }
      if (w != null) rec.weight = w
      for (const f of fields) rec[f.id] = cms[f.id]
      // Обхват, который человек перестал вести, у старой записи не стираем молча.
      if (entry) for (const f of BODY_FIELDS) if (!body.fields.includes(f.id) && entry[f.id] != null) rec[f.id] = entry[f.id]
      const id = await saveBodyEntry(userId, rec)
      if (!id) throw new Error('нечего записать')
      onClose?.()
    } catch (e) {
      showToast({ icon: 'alert', title: 'Не удалось записать', sub: String(e?.message ?? e) })
      if (aliveRef.current) setBusy(false)
    }
  }

  return (
    <SheetDialog title={entry ? 'Правка записи' : 'Записать'} actionLabel="отмена" onDismiss={onClose} swipeDown className="body-sheet">
      <DateField performedAt={dateIso} onChange={setDateIso} label="Дата записи" />

      <div className="body-field">
        <span className="body-field-lbl" id="body-w-lbl">Вес, кг</span>
        <div className="stepper body-stepper">
          <HoldButton aria-label="Вес меньше на 0.1" disabled={w == null} onTrigger={() => setWeight((v) => step(v, -0.1))}>−</HoldButton>
          <input aria-labelledby="body-w-lbl" inputMode="decimal" value={weight} placeholder="кг"
            onChange={(e) => setWeight(e.target.value)} aria-invalid={weightBad || undefined} />
          <HoldButton aria-label="Вес больше на 0.1" disabled={w == null} onTrigger={() => setWeight((v) => step(v, 0.1))}>+</HoldButton>
        </div>
        {weightBad && <p className="body-hint">Вес — от {WEIGHT_MIN} до {WEIGHT_MAX} кг.</p>}
        {!entry && !hide && last?.weight != null && (
          <p className="body-hint">Прошлый раз — {last.weight} кг, {fmtBodyDate(last.date, today)}</p>
        )}
      </div>

      <MenuRow kind="expand" icon="sliders" open={measuresOpen}
        title={fields.length ? `Замеры · ${fields.map((f) => f.label.toLowerCase()).join(', ')}` : 'Замеры'}
        sub={fields.length ? null : 'по желанию, обхваты в сантиметрах'}
        onClick={() => setMeasuresOpen((o) => !o)} />
      {measuresOpen && (
        <div className="body-measures">
          {fields.map((f) => (
            <label key={f.id} className="body-cm">
              <span>{f.label}, см</span>
              <input className="body-input" inputMode="decimal" value={cms[f.id]}
                onChange={(e) => setCms((c) => ({ ...c, [f.id]: e.target.value }))} />
            </label>
          ))}
          <button type="button" className="link-btn" aria-expanded={pickOpen} onClick={() => setPickOpen((o) => !o)}>
            Какие замеры вести…
          </button>
          {pickOpen && (
            <div className="menu-group">
              {BODY_FIELDS.map((f) => (
                <MenuRow key={f.id} kind="switch" title={f.label} checked={body.fields.includes(f.id)}
                  onClick={() => toggleField(f.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      <label className="body-field">
        <span className="body-field-lbl">Заметка</span>
        <input className="body-input" value={note} maxLength={NOTE_MAX} placeholder="необязательно"
          onChange={(e) => setNote(e.target.value)} />
      </label>

      <div className="btn-row">
        <button type="button" className="btn primary" disabled={!canSave} onClick={save}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
      </div>
    </SheetDialog>
  )
}
