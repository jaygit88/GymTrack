import { useNavigate } from 'react-router-dom'
import CardHead from './CardHead.jsx'
import Icon from './Icon.jsx'
import { PlanWeek } from '../views/Running.jsx'
import { weeklyKm, loadWarning, goalProgress, runGoalOf, fmtRaceTime, distUnit, toUnit } from '../lib/running.js'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'

// GymTrack: running on Home at a glance: this week's distance (against the goal), the plan's
// runs for this week, and a warning when the week jumped. One tap to the Running page.
export default function RunningCard({ S }) {
  const nav = useNavigate()
  const goal = runGoalOf(S)
  if (!(S.runs || []).length && !goal && !S.runPlan) return null
  const unit = S.unit, du = distUnit(unit)
  const km = n => fmtNum(Math.round(toUnit(n, unit) * 10) / 10)
  const week = weeklyKm(S, 1)[0]
  const warn = loadWarning(S)
  const p = goal?.kind === 'race' ? goalProgress(S) : null
  const sub = goal?.weeklyKm ? t('{0} of {1} this week', km(week.km), km(goal.weeklyKm) + ' ' + du) : t('{0} this week', km(week.km) + ' ' + du)
  return <div className="card tap-host run-card">
    <CardHead icon="run" tint="var(--orange)" title={t('Running')} sub={sub} open={{ onClick: () => nav('/running') }}
      action={<Icon name="chevronRight" className="chev" />} />
    {p?.estimate && <div className="small muted card-head-indent">{t('Your runs point to {0}', fmtRaceTime(p.estimate.secs))}</div>}
    <PlanWeek S={S} compact />
    {warn && <div className="run-warn small"><Icon name="warning" />{t('A big jump this week. Keep the next runs easy.')}</div>}
  </div>
}
