import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import CardHead from '../components/CardHead.jsx'
import LineChart from '../components/LineChart.jsx'
import { Button } from '../components/ui.jsx'
import { runSheet, runGoalSheet, raceName, RUN_KIND_LABEL } from '../components/RunSheets.jsx'
import { runDistance, runPace } from '../lib/runs.js'
import {
  weeklyKm, loadWarning, goalProgress, runGoalOf, planThisWeek, fmtRaceTime, distUnit, toUnit, fmt2,
} from '../lib/running.js'
import { aiReviewReady, runAiReview } from '../lib/ai-review-run.js'
import { isOn } from '../lib/modules.js'
import { fmtDate, fmtNum, durPart, DAYS } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { tappable } from '../lib/use-sheet-keyboard.js'

// GymTrack's Running page: the goal and how it is going, this week of GymTrackAI's plan, the
// trends (weekly distance, pace, efficiency, resting heart rate, VO2 max) and the runs themselves.
// Runs come from Health Connect (lib/runs.js), the numbers from lib/running.js.

/** Ask GymTrackAI for a running plan; `busy`, `error` and `ask` for the button. */
export function usePlanRequest() {
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const ready = aiReviewReady()
  const ask = async () => {
    if (!ready) {
      const st = useStore.getState()
      if (!isOn(st.S, 'coach')) st.update(s => { s.modules = { ...(s.modules || {}), coach: true } })
      nav('/coach/setup')
      return
    }
    setBusy(true); setError(null)
    try { await runAiReview('runplan') } catch (e) { if (e?.code !== 'declined') setError(e?.message || t('Try again')) }
    setBusy(false)
  }
  return { ready, busy, error, ask }
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** This week of the plan as a checklist: what is planned, which runs ticked it. */
export function PlanWeek({ S, compact = false }) {
  const week = planThisWeek(S, S.runPlan)
  if (!week) return null
  const unit = S.unit
  return <div className="run-plan">
    {!compact && <div className="lbl2">{t('Week {0} of {1}', week.index + 1, week.of)}</div>}
    {week.items.map(it => <div key={it.n} className={'run-plan-i' + (it.done ? ' done' : '')}>
      <Icon name={it.done ? 'checkCircle' : 'circle'} />
      <span className="run-plan-d">{t(DAYS[WD.indexOf(it.day)] || it.day)}</span>
      <span className="grow"><b>{t(RUN_KIND_LABEL[it.kind] || it.kind)}</b> · {fmtNum(Math.round(toUnit(it.km, unit) * 10) / 10)} {distUnit(unit)}
        {!compact && it.notes && <span className="small muted run-plan-n">{it.notes}</span>}</span>
    </div>)}
    {week.extra > 0 && !compact && <div className="small muted">{t('Plus {0} other runs this week.', week.extra)}</div>}
  </div>
}

function GoalCard({ S }) {
  const goal = runGoalOf(S)
  const p = useMemo(() => goalProgress(S), [S.runs, S.runGoal, S.fitness]) // eslint-disable-line react-hooks/exhaustive-deps
  const unit = S.unit, du = distUnit(unit)
  const per = km => fmtNum(Math.round(toUnit(km, unit) * 10) / 10) + ' ' + du
  if (!goal) return <div className="card">
    <CardHead icon="target" tint="var(--orange)" title={t('Running goal')} sub={t('Cardio fitness at a weekly distance, or a race like a half marathon.')} />
    <div className="ai-actions"><Button size="sm" variant="tinted" icon="target" onClick={runGoalSheet}>{t('Set a goal')}</Button></div>
  </div>
  const e = p?.trend?.eff
  return <div className="card">
    <CardHead icon="target" tint="var(--orange)" eyebrow={t('Running goal')}
      title={goal.kind === 'fitness' ? t('Cardio fitness, {0} a week', per(goal.weeklyKm)) : raceName(goal.raceKm) + (goal.targetSecs ? ' · ' + fmtRaceTime(goal.targetSecs) : '')}
      sub={goal.by ? t('Race day {0}', fmtDate(goal.by, true)) : null}
      action={<Button size="sm" variant="ghost" onClick={runGoalSheet}>{t('Edit')}</Button>} />
    <div className="run-goal">
      {goal.kind === 'fitness' && <div>{t('Last 4 weeks: {0} a week ({1}%)', per(p.avgKm), p.weeklyPct)}</div>}
      {goal.kind === 'race' && (p.estimate
        ? <div>{t('Your runs point to {0}', fmtRaceTime(p.estimate.secs))}{p.toGo != null && <> · <b className={p.toGo <= 0 ? 'run-good' : ''}>{p.toGo <= 0 ? t('Target reached') : t('{0} to go', fmtRaceTime(p.toGo))}</b></>}</div>
        : <div className="muted">{t('Run 3 km or more to get an estimate.')}</div>)}
      {e?.now && e?.before && <div className="small muted">{t('Metres per heartbeat: {0}, was {1}', fmt2(e.now), fmt2(e.before))}</div>}
      {p?.stalled && <div className="run-warn"><Icon name="warning" />{t('No progress in a month. A new plan from GymTrackAI can change things up.')}</div>}
    </div>
  </div>
}

function PlanCard({ S }) {
  const { ready, busy, error, ask } = usePlanRequest()
  const plan = S.runPlan
  const week = plan ? planThisWeek(S, plan) : null
  return <div className="card ai-card">
    <CardHead icon="sparkles" tint="var(--indigo)" eyebrow="GymTrackAI" title={t('Running plan')}
      sub={plan ? t('Made {0}', fmtDate(new Date(plan.at).toISOString().slice(0, 10), true)) : t('Four weeks of runs towards your goal, fitted around your lifting.')} />
    {plan && <p className="ai-sum">{plan.summary}</p>}
    {week ? <PlanWeek S={S} /> : plan && <div className="small muted">{t('This plan has run its course. Ask for the next one.')}</div>}
    {error && <div className="small ai-err">{error}</div>}
    <div className="ai-actions">
      <Button size="sm" variant={week ? 'ghost' : 'tinted'} icon="sparkles" disabled={busy || (!runGoalOf(S) && ready)} onClick={ask}>
        {!ready ? t('Set up the AI Coach') : busy ? t('GymTrackAI is thinking…') : plan ? t('New plan') : t('Make a plan')}
      </Button>
    </div>
    {ready && !runGoalOf(S) && <div className="small muted" style={{ textAlign: 'end' }}>{t('Set a running goal first.')}</div>}
  </div>
}

function Trends({ S }) {
  const unit = S.unit, du = distUnit(unit)
  const weeks = weeklyKm(S, 12)
  const recent = (S.runs || []).filter(r => r.start > Date.now() - 180 * 86400e3)
  const pace = recent.map(r => { const p = runPace(r, unit); const d = runDistance(r, unit); return p && d ? { t: r.start, d: r.d, y: Math.round((r.end - r.start) / 1000 / d.value) / 60 } : null }).filter(Boolean)
  const eff = recent.filter(r => r.eff > 0).map(r => ({ t: r.start, d: r.d, y: r.eff }))
  const rhr = (S.fitness?.rhr || []).slice(-120).map(x => ({ t: x.t, d: x.d, y: x.bpm }))
  const vo2 = (S.fitness?.vo2 || []).slice(-120).map(x => ({ t: x.t, d: x.d, y: x.v }))
  const chart = (title, sub, pts, opts = {}) => pts.length >= 2 && <div className="card">
    <CardHead title={title} sub={sub} />
    <div className="chart"><LineChart points={pts} h={130} {...opts} /></div>
  </div>
  return <>
    {chart(t('Weekly distance'), t('Last 12 weeks'), weeks.map(w => ({ t: new Date(w.start + 'T12:00:00').getTime(), d: w.start, y: Math.round(toUnit(w.km, unit) * 10) / 10 })), { unit: du, color: 'var(--orange)' })}
    {chart(t('Pace'), t('Minutes per {0}, lower is faster', du), pace, { color: 'var(--orange)', invert: true })}
    {chart(t('Metres per heartbeat'), t('Higher means fitter: more ground for each beat'), eff, { color: 'var(--green)' })}
    {chart(t('Resting heart rate'), t('Lower means fitter'), rhr, { unit: 'bpm', color: 'var(--red)', invert: true })}
    {chart(t('VO2 max'), t('As your watch estimates it'), vo2, { color: 'var(--teal)' })}
  </>
}

export default function Running() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const unit = S.unit
  const warn = loadWarning(S)
  const runs = [...(S.runs || [])].reverse().slice(0, 30)
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/home" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Running')}</h1><div className="sub">{t('From your watch, through Health Connect')}</div></div>
    </div>

    {warn && <div className="card run-warn-card"><div className="run-warn"><Icon name="warning" />
      {t('This week: {0}, against a usual {1}. Build up by about 10% a week to stay injury free.', fmtNum(Math.round(toUnit(warn.lastKm, unit) * 10) / 10) + ' ' + distUnit(unit), fmtNum(Math.round(toUnit(warn.usualKm, unit) * 10) / 10) + ' ' + distUnit(unit))}
    </div></div>}

    <GoalCard S={S} />
    <PlanCard S={S} />
    <Trends S={S} />

    <div className="card">
      <CardHead icon="run" tint="var(--orange)" title={t('Runs')} />
      {runs.length ? <div className="list">{runs.map(r => {
        const dist = runDistance(r, unit), pace = runPace(r, unit)
        return <div key={r.id} className="item" {...tappable(() => runSheet(r))}>
          <div className="grow"><div className="tt">{r.title || t('Run')}</div>
            <div className="ss">{[fmtDate(r.d, true), dist && fmtNum(dist.value) + ' ' + dist.unit, ...durPart(r.end - r.start), pace && pace.text + ' /' + pace.unit, r.hr && r.hr.avg + ' bpm'].filter(Boolean).join(' · ')}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>
      })}</div> : <div className="muted small">{t('No runs yet. Turn on Runs from your watch in Settings, Health Connect.')}</div>}
    </div>
  </div>
}
