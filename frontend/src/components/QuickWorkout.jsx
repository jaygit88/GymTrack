import { useMemo, useState } from 'react'
import { Button, Segmented } from './ui.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { quickWorkout } from '../lib/quick-workout.js'
import { EXIDX } from '../lib/exercises.js'
import { exerciseNameText } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { beginCustomWorkout } from '../sheets.jsx'

// GymTrack: "I've got 30 minutes": pick the time, see a workout built from what your log says is
// most needed (lib/quick-workout.js), and start it. "Something else" swaps the exercises.
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
  const setMinutes = m => { setMinutesState(m); setShuffle(0); try { localStorage.setItem(LAST_KEY, String(m)) } catch { /* fine */ } }
  const plan = useMemo(() => quickWorkout(S, minutes, { shuffle }), [S, minutes, shuffle])
  const start = () => beginCustomWorkout(t('Quick workout'), plan.items.map(i => ({ id: i.id, sets: i.sets, reps: i.reps, weight: 0 })), close)
  return <>
    <h3>{t('Quick workout')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('How long have you got? This picks what your last week says is most needed.')}</div>
    <Segmented value={minutes} onChange={setMinutes} options={TIMES.map(m => ({ value: m, label: t('{0} min', m) }))} />
    <div className="list qw-list">
      {plan.items.map(i => <div key={i.id} className="item">
        <div className="grow">
          <div className="tt">{EXIDX[i.id] ? exerciseNameText(EXIDX[i.id]) : i.name} <span className="muted">· {i.sets} × {i.reps}</span></div>
          <div className="ss"><b>{t(i.area.label)}</b> · {why(i)}</div>
        </div>
      </div>)}
      {!plan.items.length && <div className="empty">{t('Everything is either recovering or on target. A rest day might be the best workout.')}</div>}
    </div>
    <div className="small muted qw-foot">
      {t('About {0} min', plan.estMinutes)}
      {plan.recovering.length > 0 && <> · {t('Resting: {0}', plan.recovering.map(x => t(x)).join(', '))}</>}
    </div>
    <div className="qw-actions">
      <Button variant="ghost" icon="shuffle" onClick={() => setShuffle(n => n + 1)} disabled={!plan.items.length}>{t('Something else')}</Button>
      <Button variant="primary" icon="play" onClick={start} disabled={!plan.items.length}>{t('Start')}</Button>
    </div>
  </>
}

export const quickWorkoutSheet = () => useUI.getState().openSheet(close => <QuickWorkoutSheet close={close} />)

/** The button that opens it: on Home under the last seven days, and on the Start screen. */
export function QuickWorkoutButton({ className = '' }) {
  return <Button size="sm" variant="tinted" icon="stopwatch" className={className} onClick={quickWorkoutSheet}>{t('Short on time?')}</Button>
}
