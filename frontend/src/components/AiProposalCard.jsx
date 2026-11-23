import { Button } from './ui.jsx'
import Icon from './Icon.jsx'
import { useStore } from '../store/useStore.js'
import { applyProposal, undoProposal, exerciseLine } from '../lib/ai-plan.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import '../coach.css'

// GymTrackAI's proposal under its answer (lib/ai-plan.js): a routine to save, a routine changed,
// or a routine put on a day. Save applies it; Undo puts back what it changed; Not now leaves the
// plan alone. The outcome is kept on the chat message (S.coach.chat), so it reads the same later.

const DAY_NAME = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' }

const findMsg = (s, id) => (s.coach?.chat || []).find(x => x && x.id === id)

export default function AiProposalCard({ msgId }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const m = findMsg(S, msgId)
  const p = m?.proposal
  if (!p) return null
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const routine = p.routineId ? (S.routines || []).find(r => r.id === p.routineId) : null
  const title = p.kind === 'newRoutine' ? t('New routine: {0}', p.name)
    : p.kind === 'editRoutine' ? t('Change “{0}”', routine?.name || p.name)
      : t('Put “{0}” on your plan', routine?.name || '')
  const today = todayISO()
  const when = !p.on ? null
    : p.on.date ? (p.on.date === today ? t('Just for today. Your usual plan stays as it is.') : t('On {0} only. Your usual plan stays as it is.', fmtDate(p.on.date, true)))
      : t('Every {0}', p.on.weekdays.map(w => t(DAY_NAME[w])).join(', '))
  const save = () => update(s => { const x = findMsg(s, msgId); if (x && !x.applied) x.applied = { at: Date.now(), undo: applyProposal(s, x.proposal) } })
  const undo = () => update(s => { const x = findMsg(s, msgId); if (x?.applied) { undoProposal(s, x.applied.undo); delete x.applied; x.undone = true } })
  const decline = () => update(s => { const x = findMsg(s, msgId); if (x) x.declined = true })
  const start = async () => { const { startFlow } = await import('../sheets.jsx'); startFlow([m.applied.undo.routineId]) }
  return <div className="pcard ai-prop">
    <div className="pcard-eyebrow"><Icon name="sparkles" /> GymTrackAI</div>
    <div className="ai-prop-t">{title}</div>
    {p.exercises && <ul className="ai-prop-ex">{p.exercises.map(e => <li key={e.id}>{exerciseLine(e, unit)}</li>)}</ul>}
    {when && <div className="small muted"><Icon name="calendar" /> {when}</div>}
    {m.dropped?.length > 0 && <div className="small muted">{t('Left out, not in the exercise list: {0}', m.dropped.join(', '))}</div>}
    <div className="ai-actions">
      {m.applied ? <>
        <span className="small accent"><Icon name="checkCircle" /> {t('Saved to your plan')}</span>
        {p.on?.date === today && <Button size="sm" variant="primary" icon="play" onClick={start}>{t('Start it now')}</Button>}
        <Button size="sm" variant="ghost" onClick={undo}>{t('Undo')}</Button>
      </> : m.declined || m.undone ? <span className="small muted">{m.undone ? t('Undone. Your plan is as it was.') : t('Not saved')}</span> : <>
        <Button size="sm" variant="primary" icon="check" onClick={save}>{t('Save')}</Button>
        <Button size="sm" variant="ghost" onClick={decline}>{t('Not now')}</Button>
      </>}
    </div>
  </div>
}
