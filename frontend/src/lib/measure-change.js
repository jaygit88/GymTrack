// What changed in your body measurements over a window (a month by default), for the body
// change map on Home (components/MeasureChangeCard.jsx). Pure: state in, rows out.
//
// Each built-in field has a direction: bigger is better for the muscles you train (arms, chest,
// shoulders, legs), smaller is better for the waistline (waist, abdomen, hips, body fat), and
// wrists and ankles are bone, so they are listed but never called better or worse.
// Each field also says which parts of the body map it colours, and on which side.

import { MEASUREMENT_FIELDS, measurementValue, toMeasurementDisplay, measurementUnit } from './measurements.js'

export const BETTER = {
  neck: 1, shoulders: 1, chest: 1, waist: -1, hips: -1, abdomen: -1,
  upperArmLeft: 1, upperArmRight: 1, forearmLeft: 1, forearmRight: 1, wristLeft: 0, wristRight: 0,
  thighLeft: 1, thighRight: 1, calfLeft: 1, calfRight: 1, ankleLeft: 0, ankleRight: 0,
  bodyFat: -1,
}

// Body-map parts (lib/body-paths.js slugs) per field. `side` is the body's own left or right;
// without one, both sides take the colour. Order matters where two fields share a part: the
// later one wins, so a measured abdomen colours the abs over the waist.
export const REGIONS = {
  neck: { parts: ['neck'] },
  shoulders: { parts: ['deltoids'] },
  chest: { parts: ['chest'] },
  hips: { parts: ['gluteal', 'hip-flexors'] },
  waist: { parts: ['obliques', 'abs', 'lower-back'] },
  abdomen: { parts: ['abs'] },
  upperArmLeft: { parts: ['biceps', 'triceps'], side: 'left' },
  upperArmRight: { parts: ['biceps', 'triceps'], side: 'right' },
  forearmLeft: { parts: ['forearm'], side: 'left' },
  forearmRight: { parts: ['forearm'], side: 'right' },
  thighLeft: { parts: ['quadriceps', 'adductors', 'hamstring'], side: 'left' },
  thighRight: { parts: ['quadriceps', 'adductors', 'hamstring'], side: 'right' },
  calfLeft: { parts: ['calves', 'tibialis'], side: 'left' },
  calfRight: { parts: ['calves', 'tibialis'], side: 'right' },
}

// Below this a change is measuring noise, not a change: 3 mm of tape, 0.2 points of body fat.
const NOISE_CM = 0.3
const NOISE_PCT_POINTS = 0.2
const DAY = 86400000
const dayMs = iso => new Date(iso + 'T12:00:00').getTime()

/**
 * The change in every built-in measurement over `days`, newest reading against the reading from
 * about `days` before it. For each field: its latest reading, compared with the newest reading on
 * or before (latest - days); a field measured only within the window compares with its first
 * reading instead, so a month-old habit still shows something. One reading is no change at all.
 *
 * Returns { rows, since, to }: `rows` in MEASUREMENT_FIELDS order, each
 *   { key, label, from, to, delta, display, unit, pct, verdict, level, since, latest }
 * where `delta` is canonical (cm, or percentage points), `display` the change in the profile's
 * unit, `verdict` 'better' | 'worse' | 'same' | 'neutral', `level` 1–3 by relative size.
 * `since` is the earliest baseline date used, `to` the newest reading's date.
 */
export function measurementChanges(state, days = 30) {
  const entries = state?.measurements || []
  const unit = state?.unit || 'kg'
  const rows = []
  for (const field of MEASUREMENT_FIELDS) {
    const readings = entries.map(e => ({ d: e.d, v: measurementValue(e, field.key) })).filter(r => r.v != null)
    if (readings.length < 2) continue
    const last = readings[readings.length - 1]
    const cutoff = dayMs(last.d) - days * DAY
    const before = readings.filter(r => dayMs(r.d) <= cutoff)
    const base = before.length ? before[before.length - 1] : readings[0]
    if (base.d === last.d) continue
    const delta = Math.round((last.v - base.v) * 10) / 10
    const noise = field.key === 'bodyFat' ? NOISE_PCT_POINTS : NOISE_CM
    const dir = BETTER[field.key] ?? 0
    const verdict = Math.abs(delta) < noise ? 'same' : dir === 0 ? 'neutral' : Math.sign(delta) === dir ? 'better' : 'worse'
    const pct = base.v ? Math.abs(delta) / base.v * 100 : 0
    const level = field.key === 'bodyFat'
      ? (Math.abs(delta) < 1 ? 1 : Math.abs(delta) < 2.5 ? 2 : 3)
      : (pct < 1.5 ? 1 : pct < 4 ? 2 : 3)
    const shown = toMeasurementDisplay(Math.abs(delta), unit, field)
    rows.push({
      key: field.key, label: field.label, from: base.v, to: last.v, delta,
      display: Math.sign(delta) * shown, unit: measurementUnit(unit, field),
      pct, verdict, level, since: base.d, latest: last.d,
    })
  }
  const since = rows.reduce((m, r) => (!m || r.since < m ? r.since : m), null)
  const to = rows.reduce((m, r) => (!m || r.latest > m ? r.latest : m), null)
  return { rows, since, to }
}

/**
 * The colour each body-map part takes: { [slug]: { left?, right?, both? } } of
 * { verdict, level }. Only better and worse colour anything; a part whose field stayed the same
 * (or is neutral) keeps the plain body colour.
 */
export function regionColours(rows) {
  const byKey = new Map(rows.map(r => [r.key, r]))
  const out = {}
  for (const key of Object.keys(REGIONS)) {
    const row = byKey.get(key)
    if (!row) continue
    const { parts, side } = REGIONS[key]
    const paint = row.verdict === 'better' || row.verdict === 'worse' ? { verdict: row.verdict, level: row.level } : null
    for (const part of parts) {
      out[part] = out[part] || {}
      if (side) out[part][side] = paint
      else { out[part].left = paint; out[part].right = paint }
    }
  }
  return out
}

/**
 * Which side of the body one path of a view lies on. Every view draws the body facing out of
 * the screen (front) or away from it (back), so the viewer's left is the body's right on the
 * front and the body's left on the back. Read from the path's starting point against the
 * middle of the viewBox: muscles come in mirrored pairs, each well clear of the centre line.
 */
export function sideOfPath(d, vb, view) {
  const [x0, , w] = String(vb).split(/\s+/).map(Number)
  const m = /^\s*[Mm]\s*(-?[\d.]+)/.exec(d || '')
  if (!m) return null
  const viewerLeft = +m[1] < x0 + w / 2
  return view === 'front' ? (viewerLeft ? 'right' : 'left') : (viewerLeft ? 'left' : 'right')
}

// ---- Goals: the measurements you are working on, and the ones that stopped moving ----

// Until you choose, the goals are what most people lift for: arms, chest and a smaller waist.
export const DEFAULT_GOALS = ['upperArmLeft', 'upperArmRight', 'chest', 'waist']
// Only fields with a direction can be a goal: a wrist has no better or worse.
export const GOAL_FIELDS = MEASUREMENT_FIELDS.filter(f => BETTER[f.key])

export function goalKeys(state) {
  return Array.isArray(state?.measureGoals) ? state.measureGoals.filter(k => BETTER[k]) : DEFAULT_GOALS
}

/**
 * Goal measurements that have not improved over the last `days`: no change beyond tape noise, or
 * a change the wrong way. Only once the readings really span the window (give or take a few
 * days), so a habit started last week is not called stuck, and only from readings: a field you
 * never measured is not flagged.
 */
export function stalledGoals(state, days = 30) {
  const goals = new Set(goalKeys(state))
  return measurementChanges(state, days).rows.filter(r =>
    goals.has(r.key) && r.verdict !== 'better' && (dayMs(r.latest) - dayMs(r.since)) / DAY >= days - 3)
}
