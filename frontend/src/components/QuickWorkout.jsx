import { useMemo, useState } from 'react'
import { Button, Segmented } from './ui.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { quickWorkout } from '../lib/quick-workout.js'
import { EXIDX } from '../lib/exercises.js'
import { exerciseNameText } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { beginCustomWorkout } from '../sheets.jsx'
import { aiReviewReady, runAiReview } from '../lib/ai-review-run.js'
import { isOn } from '../lib/modules.js'

// GymTrack: "I've got 30 minutes": pick the time, see a workout built from what your log says is
// most needed (lib/quick-workout.js), and start it. "Something else" swaps the exercises.
// "Ask GymTrackAI" hands the same picture, in more detail, to the AI Coach's connection, which
// can reason about finer areas (upper chest, the heads of the triceps, rear delts, soleus...) and
// answers with exercises from a list you can do (lib/ai-review.js, mode 'quick').
// The sub-area names from lib/quick-workout.js, for the string check: t('Upper chest') t('Side delts') t('Rear delts')
const TIMES = [15, 20, 30, 45, 60]
const LAST_KEY = 'gymtrack_quick_minutes'
const lastMinutes = () => { try { const n = +localStorage.getItem(LAST_KEY); return TIMES.includes(n) ? n : 30 } catch { return 30 } }

function why(item) {
  const { sets7, target, days } = item.why
  if (days == null) return t('Not trained recently')
  if (sets7 < target) return t('{0} of {1} sets this week', Math.round(sets7), target) + ' · ' + t('{0} days ago', days)
  return t('Last trained {0} days ago', days)
}

function QuickWorkoutSheet({ close }) {
  const S = useStore(s => s.S)
  const [minutes, setMinutesState] = useState(lastMinutes)
  const [shuffle, setShuffle] = useState(0)
  const [ai, setAi] = useState(null)          // GymTrackAI's plan for `ai.minutes`
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const ready = aiReviewReady()
  const setMinutes = m => { setMinutesState(m); setShuffle(0); setAi(null); setError(null); try { localStorage.setItem(LAST_KEY, String(m)) } catch { /* fine */ } }
  const simple = useMemo(() => quickWorkout(S, minutes, { shuffle }), [S, minutes, shuffle])
  const aiPlan = ai && ai.minutes === minutes ? ai.plan : null
  const items = aiPlan ? aiPlan.items : simple.items
  const start = () => beginCustomWorkout(t('Quick workout'), items.map(i => ({ id: i.id, sets: i.sets, reps: i.reps, weight: 0 })), close)
  const askAi = async () => {
    if (!ready) {
      // The AI Coach's setup is behind its module: switch it on on the way there.
      const st = useStore.getState()
      if (!isOn(st.S, 'coach')) st.update(x => { x.modules = { ...(x.modules || {}), coach: true } })
      close()
      location.hash = '#/coach/setup'
      return
    }
    setBusy(true); setError(null)
    try { setAi({ minutes, plan: await runAiReview('quick', { minutes }) }) } catch (e) { if (e?.code !== 'declined') setError(e?.message || t('Try again')) }
    setBusy(false)
  }
  return <>
    <h3>{t('Quick workout')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('How long have you got? This picks what your last week says is most needed.')}</div>
    <Segmented value={minutes} onChange={setMinutes} options={TIMES.map(m => ({ value: m, label: t('{0} min', m) }))} />
    {aiPlan && <div className="qw-ai">
      <div className="lbl2">GymTrackAI</div>
      <p className="ai-sum">{aiPlan.summary}</p>
      {aiPlan.focus.length > 0 && <div className="qw-focus">{aiPlan.focus.map(f => <span key={f} className="chip">{f}</span>)}</div>}
    </div>}
    <div className="list qw-list">
      {items.map(i => <div key={i.id} className="item">
        <div className="grow">
          <div className="tt">{EXIDX[i.id] ? exerciseNameText(EXIDX[i.id]) : i.name} <span className="muted">· {i.sets} × {i.reps}</span></div>
          <div className="ss">{aiPlan ? i.why : <><b>{t(i.area.label)}</b> · {why(i)}</>}</div>
        </div>
      </div>)}
      {!items.length && <div className="empty">{t('Everything is either recovering or on target. A rest day might be the best workout.')}</div>}
    </div>
    <div className="small muted qw-foot">
      {t('About {0} min', aiPlan ? aiPlan.estMinutes : simple.estMinutes)}
      {simple.recovering.length > 0 && <> · {t('Resting: {0}', simple.recovering.map(x => t(x)).join(', '))}</>}
    </div>
    {error && <div className="small ai-err" style={{ marginBottom: 8 }}>{error}</div>}
    <div className="qw-actions">
      {aiPlan
        ? <Button variant="ghost" icon="shuffle" onClick={() => setAi(null)}>{t('Simple pick')}</Button>
        : <Button variant="ghost" icon="shuffle" onClick={() => setShuffle(n => n + 1)} disabled={!simple.items.length}>{t('Something else')}</Button>}
      <Button variant="primary" icon="play" onClick={start} disabled={!items.length || busy}>{t('Start')}</Button>
    </div>
    <div style={{ height: 8 }} />
    <Button variant="tinted" icon="sparkles" onClick={askAi} disabled={busy}>
      {!ready ? t('Set up the AI Coach') : busy ? t('GymTrackAI is thinking…') : aiPlan ? t('Ask again') : t('Ask GymTrackAI')}
    </Button>
  </>
}

export const quickWorkoutSheet = () => useUI.getState().openSheet(close => <QuickWorkoutSheet close={close} />)

/** The button that opens it: on Home under the last seven days, and on the Start screen. */
export function QuickWorkoutButton({ className = '' }) {
  return <Button size="sm" variant="tinted" icon="stopwatch" className={className} onClick={quickWorkoutSheet}>{t('Short on time?')}</Button>
}
