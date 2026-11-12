// GymTrack's running analysis: what one run's samples say (splits, heart rate, cadence, how
// efficiently you ran), how the weeks add up, what race time your runs point to, how a running
// goal is going, and which of this week's planned runs are done. Pure: state in, numbers out.
// The runs themselves come from Health Connect (lib/runs.js); the plan from GymTrackAI
// (lib/ai-review.js, mode 'runplan').
import { isoOf, startOfWeek, weekStartOf } from './format.js'

const DAY = 86400e3
export const KM_PER_MI = 1.609344
// Riegel's exponent: how race time grows with distance for a trained runner.
const RIEGEL = 1.06
// Shorter than this a run says little about a race, and too much about a sprint.
const MIN_ESTIMATE_KM = 3

const round1 = n => Math.round(n * 10) / 10

/* ---------- one run ---------- */

/**
 * Cumulative distance along the run from speed samples ([[ms, m/s]], oldest first): [[ms, metres]].
 * A gap longer than 30 s (the watch paused) counts as standing still, not as running on.
 */
function distanceTrack(speed) {
  const out = []
  let d = 0
  for (let i = 0; i < speed.length; i++) {
    if (i > 0) {
      const dt = (speed[i][0] - speed[i - 1][0]) / 1000
      if (dt > 0 && dt <= 30) d += speed[i - 1][1] * dt
    }
    out.push([speed[i][0], d])
  }
  return out
}

/** The seconds each full `unitM` (1000, or a mile) took, from a distance track scaled to `totalM`. */
function splitsFrom(track, startMs, unitM, totalM) {
  if (track.length < 2) return null
  const raw = track[track.length - 1][1]
  if (!(raw > unitM * 0.9)) return null
  // The watch's own total wins; speed only says how the distance was spread over the time.
  const k = totalM > 0 && totalM / raw > 0.7 && totalM / raw < 1.3 ? totalM / raw : 1
  const out = []
  let next = unitM, prevT = startMs
  for (let i = 1; i < track.length; i++) {
    const [t0, d0] = track[i - 1], [t1, d1] = track[i]
    while (d1 * k >= next && d1 > d0) {
      const at = t0 + (t1 - t0) * ((next / k - d0) / (d1 - d0))
      out.push(Math.round((at - prevT) / 1000))
      prevT = at
      next += unitM
    }
  }
  return out.length ? out : null
}

/** Splits from the watch's own laps, when they are whole kilometres (or miles). */
function splitsFromLaps(laps, unitM) {
  if (!Array.isArray(laps) || !laps.length) return null
  const ok = laps.every(l => Math.abs(l[2] - unitM) < unitM * 0.03)
  return ok ? laps.map(l => Math.round((l[1] - l[0]) / 1000)) : null
}

/**
 * One run's samples from Health Connect summarised for keeping: what the run row, the run sheet,
 * the charts and GymTrackAI read. Samples are not kept; this is.
 *   in:  { start, end, meters, hr: [[ms, bpm]], speed: [[ms, m/s]], laps: [[start, end, m]], steps, elevation, kcal }
 *   out: { hr: { avg, max }, hrb: { [bpm floor to 5]: seconds }, splitsKm, splitsMi, cadence, elevM, kcal, eff, dec }
 * Each part is left out (null) when its data is missing.
 */
export function summarizeRunDetail(s) {
  const out = {}
  const start = Number(s?.start), end = Number(s?.end), meters = Number(s?.meters) || 0
  const minutes = (end - start) / 60000
  const hr = (Array.isArray(s?.hr) ? s.hr : []).filter(x => Array.isArray(x) && x[1] >= 30 && x[1] <= 240)
  if (hr.length >= 3) {
    // Time-weighted: each sample stands for the time until the next one (at most 30 s).
    let sum = 0, w = 0, max = 0
    const hrb = {}
    for (let i = 0; i < hr.length; i++) {
      const dt = i + 1 < hr.length ? Math.min(30, (hr[i + 1][0] - hr[i][0]) / 1000) : 5
      if (!(dt > 0)) continue
      sum += hr[i][1] * dt; w += dt
      if (hr[i][1] > max) max = hr[i][1]
      const b = Math.floor(hr[i][1] / 5) * 5
      hrb[b] = Math.round((hrb[b] || 0) + dt)
    }
    if (w > 0) { out.hr = { avg: Math.round(sum / w), max }; out.hrb = hrb }
  }
  const speed = (Array.isArray(s?.speed) ? s.speed : []).filter(x => Array.isArray(x) && x[1] >= 0)
  const track = distanceTrack(speed)
  out.splitsKm = splitsFromLaps(s?.laps, 1000) || splitsFrom(track, start, 1000, meters)
  out.splitsMi = splitsFromLaps(s?.laps, KM_PER_MI * 1000) || splitsFrom(track, start, KM_PER_MI * 1000, meters)
  const steps = Number(s?.steps)
  if (steps > 0 && minutes > 0) {
    const spm = Math.round(steps / minutes)
    if (spm >= 100 && spm <= 240) out.cadence = spm
  }
  if (Number(s?.elevation) >= 0 && s?.elevation != null) out.elevM = Math.round(Number(s.elevation))
  if (Number(s?.kcal) > 0) out.kcal = Math.round(Number(s.kcal))
  // Efficiency: metres covered per heartbeat. Going up at the same effort is cardio fitness.
  if (out.hr && meters > 0 && minutes > 0) out.eff = Math.round(meters / (out.hr.avg * minutes) * 100) / 100
  // Decoupling: how much pace-per-beat fell from the first half to the second. Under about 5 %
  // on a steady run means the aerobic base held up; more means the run outlasted it.
  if (hr.length >= 6 && track.length >= 6) {
    const mid = start + (end - start) / 2
    const distAt = t => { let d = 0; for (const [tt, dd] of track) { if (tt > t) break; d = dd } return d }
    const avgHr = (a, b) => { const xs = hr.filter(x => x[0] >= a && x[0] < b).map(x => x[1]); return xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : 0 }
    const d1 = distAt(mid), d2 = distAt(end) - d1, h1 = avgHr(start, mid), h2 = avgHr(mid, end + 1)
    if (d1 > 0 && d2 > 0 && h1 > 0 && h2 > 0) {
      const r1 = d1 / h1, r2 = d2 / h2
      out.dec = round1((r1 - r2) / r1 * 100)
    }
  }
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k]
  return out
}

/* ---------- formatting ---------- */

/** "5:23" for seconds per km or mile; null without. */
export function fmtPace(secs) {
  if (!(secs > 0) || secs > 3600) return null
  const s = Math.round(secs)
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}
/** "24:10" or "1:52:07" for a race time. */
export function fmtRaceTime(secs) {
  if (!(secs > 0)) return null
  const s = Math.round(secs), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0')
}
/** "25:00" or "1:55:00" read back into seconds; null when it is not a time. */
export function parseRaceTime(text) {
  const parts = String(text || '').trim().split(':').map(p => p.trim())
  if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d{1,2}$/.test(p))) return null
  const n = parts.map(Number)
  const secs = n.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n[0] * 60 + n[1]
  return secs > 0 ? secs : null
}
/** Two decimals in the UI language, for metres per heartbeat (1.18 against 1.24 is the whole story). */
export const fmt2 = n => (Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '')
/** A split's bar, 0 to 100: the fastest full, each 1 % slower 4 points shorter, never under 20. */
export const splitBar = (secs, fastest) => Math.max(20, Math.round(100 - (secs - fastest) / fastest * 400))
export const distUnit = unit => (unit === 'lb' ? 'mi' : 'km')
export const toUnit = (km, unit) => (unit === 'lb' ? km / KM_PER_MI : km)

/* ---------- the weeks ---------- */

const runsIn = (S, fromMs, toMs) => (S?.runs || []).filter(r => r && r.start >= fromMs && r.start < toMs)

/** Distance per week for the last `weeks` weeks, oldest first, the current week last (so far). */
export function weeklyKm(S, weeks = 12, now = Date.now()) {
  const ws = weekStartOf(S)
  const thisStart = startOfWeek(isoOf(new Date(now)), ws).getTime() - 12 * 3600e3   // midnight
  const out = []
  for (let i = weeks - 1; i >= 0; i--) {
    const from = thisStart - i * 7 * DAY, to = from + 7 * DAY
    const rs = runsIn(S, from, to)
    out.push({ start: isoOf(new Date(from + 12 * 3600e3)), km: round1(rs.reduce((n, r) => n + (r.km || 0), 0)), runs: rs.length })
  }
  return out
}

/**
 * Too much too soon: the last seven days against the weekly average of the three weeks before.
 * A jump of more than 30 % is the classic way into a running injury. Null when it is fine, or
 * when there is too little before to compare with.
 */
export function loadWarning(S, now = Date.now()) {
  const last = runsIn(S, now - 7 * DAY, now + 1).reduce((n, r) => n + (r.km || 0), 0)
  const before = runsIn(S, now - 28 * DAY, now - 7 * DAY).reduce((n, r) => n + (r.km || 0), 0) / 3
  if (before < 5 || last <= before * 1.3) return null
  return { lastKm: round1(last), usualKm: round1(before), ratio: round1(last / before) }
}

/* ---------- what the runs say ---------- */

/**
 * The race time your recent runs point to for `distanceKm`, by Riegel's formula from each run of
 * 3 km or more in the window (six weeks), the best of them. Easy runs predict slowly, so this is
 * a floor on what you could race, not a promise. Null without a usable run.
 */
export function raceEstimate(S, distanceKm, now = Date.now(), windowDays = 42) {
  let best = null
  for (const r of runsIn(S, now - windowDays * DAY, now + 1)) {
    if (!(r.km >= MIN_ESTIMATE_KM) || !(r.end > r.start)) continue
    const t1 = (r.end - r.start) / 1000
    const secs = t1 * Math.pow(distanceKm / r.km, RIEGEL)
    if (!best || secs < best.secs) best = { secs: Math.round(secs), from: r.id, d: r.d }
  }
  return best
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** Cardio fitness over two windows of `days`: efficiency, resting heart rate and VO2 max, now and before. */
export function fitnessTrend(S, now = Date.now(), days = 30) {
  const cut = now - days * DAY, cut2 = now - 2 * days * DAY
  const eff = (a, b) => mean(runsIn(S, a, b).map(r => r.eff).filter(x => x > 0))
  const effN = (a, b) => runsIn(S, a, b).filter(r => r.eff > 0).length
  const series = (key, val) => (S?.fitness?.[key] || []).filter(x => x && x.d && val(x) > 0)
  const inDays = (xs, a, b) => xs.filter(x => { const t = new Date(x.d + 'T12:00:00').getTime(); return t >= a && t < b })
  const rhr = series('rhr', x => x.bpm), vo2 = series('vo2', x => x.v)
  const avg = (xs, val) => { const m = mean(xs.map(val)); return m == null ? null : round1(m) }
  return {
    eff: { now: eff(cut, now + 1), before: eff(cut2, cut), runsNow: effN(cut, now + 1), runsBefore: effN(cut2, cut) },
    rhr: { now: avg(inDays(rhr, cut, now + 1), x => x.bpm), before: avg(inDays(rhr, cut2, cut), x => x.bpm) },
    vo2: { now: avg(inDays(vo2, cut, now + 1), x => x.v), before: avg(inDays(vo2, cut2, cut), x => x.v) },
  }
}

/* ---------- the goal ---------- */

export const RACE_DISTANCES = [5, 10, 21.0975, 42.195]
export const GOAL_KINDS = ['fitness', 'race']

/** The running goal, cleaned: { kind, weeklyKm, raceKm, targetSecs, by } or null. */
export function runGoalOf(S) {
  const g = S?.runGoal
  if (!g || !GOAL_KINDS.includes(g.kind)) return null
  const weeklyKm = g.weeklyKm > 0 && g.weeklyKm <= 200 ? g.weeklyKm : null
  if (g.kind === 'fitness') return weeklyKm ? { kind: 'fitness', weeklyKm } : null
  const raceKm = g.raceKm > 0 && g.raceKm <= 100 ? g.raceKm : null
  if (!raceKm) return null
  return { kind: 'race', raceKm, targetSecs: g.targetSecs > 0 ? g.targetSecs : null, weeklyKm, by: typeof g.by === 'string' ? g.by : null }
}

/**
 * How the goal is going. Fitness: the last four weeks' average distance against the weekly target,
 * and whether running got more efficient this month. Race: the estimate against the target time.
 * `stalled` is set when the month brought nothing: the race estimate no faster than a month ago,
 * or (fitness) efficiency no better on at least three runs with heart rate in each month.
 */
export function goalProgress(S, now = Date.now()) {
  const goal = runGoalOf(S)
  if (!goal) return null
  const weeks = weeklyKm(S, 5, now).slice(0, 4)
  const avgKm = round1(weeks.reduce((n, w) => n + w.km, 0) / 4)
  const trend = fitnessTrend(S, now)
  if (goal.kind === 'fitness') {
    const e = trend.eff
    const stalled = e.runsNow >= 3 && e.runsBefore >= 3 && e.now <= e.before * 1.01
    return { goal, avgKm, weeklyPct: Math.round(avgKm / goal.weeklyKm * 100), trend, stalled }
  }
  const est = raceEstimate(S, goal.raceKm, now)
  const was = raceEstimate(S, goal.raceKm, now - 30 * DAY)
  const stalled = !!(est && was && est.secs >= was.secs - 5)
  return { goal, avgKm, estimate: est, previous: was, toGo: est && goal.targetSecs ? est.secs - goal.targetSecs : null, trend, stalled }
}

/* ---------- the plan ---------- */

export const RUN_KINDS = ['easy', 'long', 'tempo', 'intervals', 'recovery']

/** The plan's week that holds `now` (0-based), or -1 before it starts / past its end. */
export function planWeekIndex(plan, now = Date.now()) {
  if (!plan?.startsOn || !Array.isArray(plan.weeks)) return -1
  const i = Math.floor((now - new Date(plan.startsOn + 'T00:00:00').getTime()) / (7 * DAY))
  return i >= 0 && i < plan.weeks.length ? i : -1
}

/**
 * This week's planned runs, each with the run that did it, if any. Days are a suggestion: a run
 * anywhere in the week ticks a planned run within 35 % of its distance, the closest pairs first.
 */
export function planThisWeek(S, plan, now = Date.now()) {
  const i = planWeekIndex(plan, now)
  if (i < 0) return null
  const from = new Date(plan.startsOn + 'T00:00:00').getTime() + i * 7 * DAY
  const runs = runsIn(S, from, from + 7 * DAY).filter(r => r.km > 0)
  const items = plan.weeks[i].runs.map((p, n) => ({ ...p, n, done: null }))
  const used = new Set(), taken = new Set()
  const pairs = []
  for (const it of items) for (const r of runs) {
    const off = Math.abs(r.km - (it.km || 0)) / Math.max(1, it.km || 1)
    if (off <= 0.35) pairs.push({ it, r, off })
  }
  pairs.sort((a, b) => a.off - b.off)
  for (const { it, r } of pairs) {
    if (used.has(r.id) || taken.has(it.n)) continue
    used.add(r.id); taken.add(it.n); it.done = r.id
  }
  return { index: i, of: plan.weeks.length, from: isoOf(new Date(from + 12 * 3600e3)), items, extra: runs.filter(r => !used.has(r.id)).length }
}

/* ---------- fitness readings ---------- */

/** VO2 max and resting heart rate from the hub into S.fitness ({ vo2: [{ d, v }], rhr: [{ d, bpm }] }), one per day. Returns how many changed. */
export function mergeFitness(S, { vo2max = [], restingHr = [] } = {}, now = Date.now()) {
  const f = S.fitness && typeof S.fitness === 'object' ? S.fitness : (S.fitness = {})
  let changed = 0
  const put = (key, list, val, ok) => {
    const byDay = new Map((f[key] || []).map(x => [x.d, x]))
    for (const [t, v] of Array.isArray(list) ? list : []) {
      if (!(t > 0) || !ok(v) || t > now + DAY) continue
      const d = isoOf(new Date(t))
      const prev = byDay.get(d)
      if (prev && prev.t >= t) continue
      byDay.set(d, { d, t, [val]: round1(v) }); changed++
    }
    f[key] = [...byDay.values()].filter(x => x.t > now - 400 * DAY).sort((a, b) => a.t - b.t)
  }
  put('vo2', vo2max, 'v', v => v > 10 && v < 100)
  put('rhr', restingHr, 'bpm', v => v >= 25 && v <= 150)
  return changed
}
