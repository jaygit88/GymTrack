import CardHead from './CardHead.jsx'
import { Button } from './ui.jsx'
import { useStore } from '../store/useStore.js'
import { weekSummary, summaryWeekFor } from '../lib/week-summary.js'
import { distUnit, toUnit } from '../lib/running.js'
import { aiReviewReady } from '../lib/ai-review-run.js'
import { aiChatSheet } from './AiChatSheet.jsx'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'

// GymTrack's weekly summary on Home (lib/week-summary.js): the week's lifting, running, food and
// weight in four lines, from its last day until two days into the next, or until you tap Done.

export default function WeekSummaryCard({ S }) {
  const update = useStore(s => s.update)
  const from = summaryWeekFor(S, todayISO())
  if (!from || S.weekSummaryDone === from) return null
  const s = weekSummary(S, from)
  if (s.empty) return null
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const lines = []
  const tr = s.training
  if (tr.workouts) lines.push({ k: t('Lifting'), v: [tn('{0} workout', '{0} workouts', tr.workouts), tn('{0} set', '{0} sets', tr.sets), tr.prs ? tn('{0} record', '{0} records', tr.prs) : null].filter(Boolean).join(' · '),
    sub: tr.below.length ? t('Room for more: {0}', tr.below.slice(0, 3).map(n => t(n)).join(', ')) : t('Every main muscle in its weekly range') })
  const ru = s.running
  if (ru.runs || ru.planned) lines.push({ k: t('Running'), v: [tn('{0} run', '{0} runs', ru.runs), ru.km ? fmtNum(Math.round(toUnit(ru.km, unit) * 10) / 10) + ' ' + distUnit(unit) : null].filter(Boolean).join(' · '),
    sub: ru.planned ? t('{0} of {1} planned runs', ru.planned.done, ru.planned.of) : null })
  const f = s.food
  if (f) lines.push({ k: t('Food'), v: t('{0} kcal a day', fmtNum(f.kcal)) + (f.budget ? ' / ' + fmtNum(f.budget) : '') + ' · ' + t('{0} g protein', fmtNum(f.protein)) + (f.proteinTarget ? ' / ' + fmtNum(f.proteinTarget) : ''),
    sub: t('{0} of 7 days logged', f.days) + (s.burned ? ' · ' + t('About {0} kcal burned', fmtNum(s.burned)) : '') })
  const w = s.weight
  if (w) lines.push({ k: t('Weight'), v: t('Average {0}', fmtNum(w.avg) + ' ' + unit),
    sub: w.change == null ? null : w.change === 0 ? t('Same as the week before') : t('{0} on the week before', (w.change > 0 ? '+' : '') + fmtNum(w.change) + ' ' + unit) })
  return <div className="card week-sum">
    <CardHead icon="calendar" tint="var(--teal)" title={t('Your week')} sub={t('{0} to {1}', fmtDate(s.from, true), fmtDate(s.to, true))} />
    <div className="week-sum-l">{lines.map(l => <div key={l.k} className="week-sum-i">
      <span className="lbl2">{l.k}</span>
      <div><div className="week-sum-v">{l.v}</div>{l.sub && <div className="small muted">{l.sub}</div>}</div>
    </div>)}</div>
    <div className="ai-actions">
      {aiReviewReady() && <Button size="sm" variant="tinted" icon="sparkles" onClick={() => aiChatSheet({ screen: 'general' })}>{t('Ask GymTrackAI')}</Button>}
      <Button size="sm" variant="ghost" onClick={() => update(st => { st.weekSummaryDone = from })}>{t('Done')}</Button>
    </div>
  </div>
}
