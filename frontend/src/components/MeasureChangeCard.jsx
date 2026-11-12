import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CardHead from './CardHead.jsx'
import { Button, Segmented, Section, Switch } from './ui.jsx'
import Icon from './Icon.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useBodyPaths } from './BodyMap.jsx'
import { measurementChanges, regionColours, sideOfPath, goalKeys, GOAL_FIELDS } from '../lib/measure-change.js'
import { measurementUnitLabel } from '../lib/measurements.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'

// Home's body change map: how each measured body part moved over the last 1, 3 or 6 months, on the body
// itself. Green where it went the way you want (bigger arms, chest and legs, a smaller waist),
// red where it went the other way, stronger for a bigger change; untouched where it held steady
// or was not measured. The numbers follow underneath. The logic is lib/measure-change.js.

// Parts drawn as plain silhouette unless a measurement colours them (the neck can be).
const SILHOUETTE = new Set(['head', 'hair', 'neck', 'hands', 'feet', 'knees', 'ankles'])

function ChangeView({ view, name, colours }) {
  return <svg className="bm-v" viewBox={view.vb} aria-hidden="true">
    {Object.entries(view.p).map(([slug, list]) => list.map((d, i) => {
      const c = colours[slug]
      const paint = c && c[sideOfPath(d, view.vb, name)]
      const cls = paint ? `bm-m mc-${paint.verdict} mc-l${paint.level}` : SILHOUETTE.has(slug) ? 'bm-sil' : 'bm-m'
      return <path key={slug + i} className={cls} d={d} />
    }))}
  </svg>
}

// The window you last picked, on this device only (a viewing preference, not your data).
const RANGE_KEY = 'gymtrack_mchange_days'
const RANGES = [30, 90, 180]
const savedRange = () => { try { const n = +localStorage.getItem(RANGE_KEY); return RANGES.includes(n) ? n : 30 } catch { return 30 } }

// Pick the measurements you are working on: Home flags them when they stop improving.
function GoalsSheet({ close }) {
  const S = useStore(s => s.S)
  const goals = goalKeys(S)
  const toggle = (key, on) => useStore.getState().update(st => {
    const set = new Set(goalKeys(st))
    if (on) set.add(key); else set.delete(key)
    st.measureGoals = GOAL_FIELDS.map(f => f.key).filter(k => set.has(k))
  })
  const groups = [...new Set(GOAL_FIELDS.map(f => f.group))]
  return <>
    <h3>{t('Measurement goals')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Home warns you when one of these has not improved for a month.')}</div>
    {groups.map(group => <Section title={t(group)} key={group}>
      {GOAL_FIELDS.filter(f => f.group === group).map(f => <div className="lrow" key={f.key}>
        <span className="lrow-m"><span className="lrow-t">{t(f.label)}</span></span>
        <Switch checked={goals.includes(f.key)} onChange={on => toggle(f.key, on)} />
      </div>)}
    </Section>)}
    <div style={{ height: 8 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const goalsSheet = () => useUI.getState().openSheet(close => <GoalsSheet close={close} />)

const openLog = () => import('../views/Measurements.jsx').then(m => m.measurementLogSheet())

export default function MeasureChangeCard({ S }) {
  const nav = useNavigate()
  const [days, setDaysState] = useState(savedRange)
  const setDays = n => { setDaysState(n); try { localStorage.setItem(RANGE_KEY, String(n)) } catch { /* private mode: just this session */ } }
  const paths = useBodyPaths()
  const { rows, since } = useMemo(() => measurementChanges(S, days), [S.measurements, S.unit, days]) // eslint-disable-line react-hooks/exhaustive-deps
  const colours = useMemo(() => regionColours(rows), [rows])
  const g = paths && (paths[S.body] || paths.male)
  const goals = goalKeys(S)
  const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '')
  return <div className="card tap-host mchange-card">
    <CardHead icon="ruler" tint="var(--teal)" title={t('Body measurements')}
      sub={since ? t('Since {0}', fmtDate(since, true)) : null}
      open={{ onClick: () => nav('/measurements') }}
      action={<Button size="sm" icon="plus" onClick={openLog}>{t('Log')}</Button>} />
    <Segmented className="seg-range mchange-range" value={days} onChange={setDays}
      options={[{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 180, label: '6M' }]} />
    {rows.length ? <>
      <div className="bodymap mchange-map">
        {g ? <><ChangeView view={g.front} name="front" colours={colours} /><ChangeView view={g.back} name="back" colours={colours} /></>
          : <div className="bm-ph" aria-hidden="true" />}
      </div>
      <div className="mchange-legend small dim" aria-hidden="true">
        <span><i className="mc-sw mc-better" />{t('Better')}</span>
        <span><i className="mc-sw mc-worse" />{t('Worse')}</span>
      </div>
      <div className="mchange-rows">
        {rows.map(r => <div key={r.key} className={'mchange-row v-' + r.verdict}>
          <span className="small">{goals.includes(r.key) && <Icon name="target" className="mchange-goal" />}{t(r.label)}</span>
          <span className="small mchange-d">{r.verdict === 'same' ? '±0' : sign(r.display) + fmtNum(Math.abs(r.display))} {measurementUnitLabel(r.unit)}</span>
        </div>)}
      </div>
    </> : <div className="muted small">{t('Measure at least twice to see what changed.')}</div>}
    <div className="mchange-foot">
      <Button size="sm" variant="ghost" icon="target" onClick={goalsSheet}>{t('Goals')}</Button>
    </div>
  </div>
}
