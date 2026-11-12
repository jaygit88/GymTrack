import { useState } from 'react'
import Icon from './Icon.jsx'
import DateField from './DateField.jsx'
import { Button, Segmented, Section, Row, NumberField } from './ui.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { runDistance, runPace } from '../lib/runs.js'
import { fmtPace, fmtRaceTime, parseRaceTime, distUnit, toUnit, KM_PER_MI, RACE_DISTANCES, runGoalOf, fmt2, splitBar } from '../lib/running.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'

// GymTrack: the run sheet (everything the watch saved about one run) and the running goal sheet.

export const RUN_KIND_LABEL = { easy: 'Easy', long: 'Long run', tempo: 'Tempo', intervals: 'Intervals', recovery: 'Recovery' }
// The labels above, spelled out once so the string check sees them: t('Easy') t('Long run') t('Tempo')
// 5K and 10K read the same in every language; the two marathons are translated.
export const raceName = km => (km === 5 ? '5K' : km === 10 ? '10K' : km === 21.0975 ? t('Half marathon') : km === 42.195 ? t('Marathon') : fmtNum(km) + ' km')

/** The highest heart rate seen on a run in the last year: the top of the zones, until there is a better one. */
export function maxHrOf(S, now = Date.now()) {
  const m = (S?.runs || []).filter(r => r?.hr?.max && r.start > now - 365 * 86400e3).reduce((a, r) => Math.max(a, r.hr.max), 0)
  return m >= 150 ? m : null
}

/** Seconds in each of five zones (by share of max heart rate: <60, 60-70, 70-80, 80-90, 90+ %). */
export function zonesOf(hrb, maxHr) {
  if (!hrb || !maxHr) return null
  const z = [0, 0, 0, 0, 0]
  for (const [b, secs] of Object.entries(hrb)) {
    const pct = (Number(b) + 2.5) / maxHr
    z[pct < 0.6 ? 0 : pct < 0.7 ? 1 : pct < 0.8 ? 2 : pct < 0.9 ? 3 : 4] += secs
  }
  return z.reduce((a, b) => a + b, 0) > 0 ? z : null
}

function Stat({ label, value }) {
  return value == null ? null : <div className="run-stat"><div className="lbl2">{label}</div><div className="run-stat-v">{value}</div></div>
}

function RunSheet({ run, close }) {
  const S = useStore(s => s.S)
  const unit = S.unit
  const dist = runDistance(run, unit), pace = runPace(run, unit)
  const splits = unit === 'lb' ? run.splitsMi : run.splitsKm
  const zones = zonesOf(run.hrb, maxHrOf(S))
  const zoneTotal = zones ? zones.reduce((a, b) => a + b, 0) : 0
  const fastest = splits?.length ? Math.min(...splits) : 0
  return <>
    <h3>{run.title || t('Run')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{fmtDate(run.d, true)}</div>
    <div className="run-stats">
      <Stat label={t('Distance')} value={dist && `${fmtNum(dist.value)} ${dist.unit}`} />
      <Stat label={t('Time')} value={fmtRaceTime((run.end - run.start) / 1000)} />
      <Stat label={t('Pace')} value={pace && `${pace.text} /${pace.unit}`} />
      <Stat label={t('Avg heart rate')} value={run.hr && `${run.hr.avg} bpm`} />
      <Stat label={t('Max heart rate')} value={run.hr && `${run.hr.max} bpm`} />
      <Stat label={t('Cadence')} value={run.cadence && `${run.cadence} spm`} />
      <Stat label={t('Climb')} value={run.elevM != null ? `${run.elevM} m` : null} />
      <Stat label={t('Energy')} value={run.kcal && `${run.kcal} kcal`} />
      <Stat label={t('Metres per heartbeat')} value={run.eff && fmt2(run.eff)} />
    </div>
    {run.dec != null && <div className="small muted run-note">
      <Icon name={run.dec <= 5 ? 'check' : 'info'} />
      {run.dec <= 5 ? t('Steady heart rate for the pace all the way: your aerobic base held up.') : t('Your heart worked {0}% harder for the pace in the second half. Longer easy runs build this up.', fmtNum(run.dec))}
    </div>}
    {splits?.length > 0 && <Section title={t('Splits')}>
      {splits.map((s, i) => <div key={i} className="lrow run-split">
        <span className="lrow-m"><span className="lrow-t">{i + 1} {distUnit(unit)}</span></span>
        <span className="run-split-bar"><i style={{ width: splitBar(s, fastest) + '%' }} /></span>
        <span className="run-split-v">{fmtPace(s)}</span>
      </div>)}
    </Section>}
    {zones && <Section title={t('Heart rate zones')}>
      {zones.map((secs, i) => <div key={i} className="lrow run-split">
        <span className="lrow-m"><span className="lrow-t">{t('Zone {0}', i + 1)}</span></span>
        <span className={'run-split-bar z' + (i + 1)}><i style={{ width: Math.round(secs / zoneTotal * 100) + '%' }} /></span>
        <span className="run-split-v">{Math.round(secs / zoneTotal * 100)}%</span>
      </div>)}
    </Section>}
    <div style={{ height: 8 }} />
    <Button onClick={close}>{t('Done')}</Button>
  </>
}
export const runSheet = run => useUI.getState().openSheet(close => <RunSheet run={run} close={close} />)

function GoalSheet({ close }) {
  const S = useStore(s => s.S)
  const unit = S.unit
  const cur = runGoalOf(S)
  const [kind, setKind] = useState(cur?.kind || 'fitness')
  const [weekly, setWeekly] = useState(cur?.weeklyKm ? Math.round(toUnit(cur.weeklyKm, unit) * 10) / 10 : (unit === 'lb' ? 10 : 15))
  const [raceKm, setRaceKm] = useState(cur?.raceKm || 21.0975)
  const [target, setTarget] = useState(cur?.targetSecs ? fmtRaceTime(cur.targetSecs) : '')
  const [by, setBy] = useState(cur?.by || '')
  const save = () => {
    const weeklyKm = weekly > 0 ? Math.round((unit === 'lb' ? weekly * KM_PER_MI : weekly) * 10) / 10 : null
    const goal = kind === 'fitness' ? { kind, weeklyKm } : { kind, raceKm, targetSecs: parseRaceTime(target), weeklyKm: null, by: /^\d{4}-\d{2}-\d{2}$/.test(by) ? by : null }
    useStore.getState().update(s => { s.runGoal = goal })
    close()
  }
  return <>
    <h3>{t('Running goal')}</h3>
    <Segmented value={kind} onChange={setKind} options={[{ value: 'fitness', label: t('Cardio fitness') }, { value: 'race', label: t('A race') }]} />
    <div style={{ height: 12 }} />
    {kind === 'fitness' ? <Section footer={t('Mostly easy running for heart and lungs, kept light enough not to get in the way of your lifting.')}>
      <Row title={t('Distance a week')} subtitle={distUnit(unit)}>
        <NumberField value={weekly} onChange={setWeekly} fit />
      </Row>
    </Section> : <Section footer={t('The plan builds up to the distance; leave the time empty to just finish.')}>
      <Segmented value={raceKm} onChange={setRaceKm} options={RACE_DISTANCES.map(km => ({ value: km, label: raceName(km) }))} />
      <Row title={t('Target time')} subtitle="h:mm:ss">
        <input className="field run-time" value={target} onChange={e => setTarget(e.target.value)} placeholder="1:55:00" inputMode="numeric" aria-label={t('Target time')} />
      </Row>
      <Row title={t('Race day')} subtitle={t('Optional')}>
        <DateField compact value={by || null} min={todayISO()} onChange={setBy} label={t('Race day')} />
      </Row>
    </Section>}
    <div style={{ height: 8 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {cur && <><div style={{ height: 8 }} /><Button variant="ghost" onClick={() => { useStore.getState().update(s => { s.runGoal = null }); close() }}>{t('Remove goal')}</Button></>}
  </>
}
export const runGoalSheet = () => useUI.getState().openSheet(close => <GoalSheet close={close} />)
