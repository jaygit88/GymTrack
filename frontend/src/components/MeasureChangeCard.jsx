import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import CardHead from './CardHead.jsx'
import { Button } from './ui.jsx'
import { useBodyPaths } from './BodyMap.jsx'
import { measurementChanges, regionColours, sideOfPath } from '../lib/measure-change.js'
import { measurementUnitLabel } from '../lib/measurements.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'

// Home's body change map: how each measured body part moved over the last month, on the body
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

const openLog = () => import('../views/Measurements.jsx').then(m => m.measurementLogSheet())

export default function MeasureChangeCard({ S, days = 30 }) {
  const nav = useNavigate()
  const paths = useBodyPaths()
  const { rows, since } = useMemo(() => measurementChanges(S, days), [S.measurements, S.unit, days]) // eslint-disable-line react-hooks/exhaustive-deps
  const colours = useMemo(() => regionColours(rows), [rows])
  const g = paths && (paths[S.body] || paths.male)
  const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '')
  return <div className="card tap-host mchange-card">
    <CardHead icon="ruler" tint="var(--teal)" title={t('Body measurements')}
      sub={since ? t('Since {0}', fmtDate(since, true)) : null}
      open={{ onClick: () => nav('/measurements') }}
      action={<Button size="sm" icon="plus" onClick={openLog}>{t('Log')}</Button>} />
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
          <span className="small">{t(r.label)}</span>
          <span className="small mchange-d">{r.verdict === 'same' ? '±0' : sign(r.display) + fmtNum(Math.abs(r.display))} {measurementUnitLabel(r.unit)}</span>
        </div>)}
      </div>
    </> : <div className="muted small">{t('Measure at least twice to see what changed.')}</div>}
  </div>
}
