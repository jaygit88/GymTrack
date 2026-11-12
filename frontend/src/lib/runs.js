// Runs read in from Health Connect (GymTrack): what a Galaxy Watch saved to Samsung Health, or any
// other app that shares its workouts with Health Connect. They live in S.runs, beside the
// workouts and never inside them, so nothing that reads a lifting session (progression, PRs,
// volume, the streak) has to know about them. Home's last seven days lists them among the
// workouts (components/RecentDays.jsx); the monthly review reads them too.
//
// A run: { id, d, start, end, km, title, type, src }. `id` is the hub's record id with a prefix,
// so a second read of the same run updates it (a watch can sync its distance late) instead of
// adding it twice. Pure: lib/health-sync.js reads the hub and hands the sessions over.
import { isOwnRecord } from './health-read.js'
import { isoOf } from './format.js'

// The session types that count as a run; walks, rides and the rest are left out for now.
export const RUN_TYPES = new Set(['running', 'running_treadmill'])
// Shorter than this is a mis-tap on the watch, not a run.
const MIN_MS = 3 * 60e3
// Longer than this is a session someone forgot to stop.
const MAX_MS = 8 * 3600e3
// How far back runs are kept: enough for the monthly review, small enough for a backup.
export const KEEP_DAYS = 400
export const KM_PER_MI = 1.609344

/**
 * Sessions from the hub (`sessions`: [{ id, origin, clientId, start, end, type, title, meters }])
 * put into S.runs (mutated). Runs only; openGym's own sessions are never read back; one already
 * there by id is updated when its distance, time or title changed. Returns how many changed.
 */
export function mergeRuns(S, sessions, { src = 'hc', now = Date.now() } = {}) {
  if (!Array.isArray(S.runs)) S.runs = []
  let changed = 0
  for (const s of Array.isArray(sessions) ? sessions : []) {
    if (!s || isOwnRecord(s) || !RUN_TYPES.has(s.type) || !s.id) continue
    const start = Number(s.start), end = Number(s.end)
    if (!(start > 0) || !(end - start >= MIN_MS) || end - start > MAX_MS || start > now) continue
    const m = Number(s.meters)
    const run = {
      id: src + ':' + s.id, d: isoOf(new Date(start)), start, end,
      km: m > 0 ? Math.round(m / 10) / 100 : null,
      title: typeof s.title === 'string' && s.title.trim() ? s.title.trim().slice(0, 80) : null,
      type: s.type, src,
    }
    const i = S.runs.findIndex(r => r && r.id === run.id)
    if (i < 0) { S.runs.push(run); changed++ }
    else if (['d', 'start', 'end', 'km', 'title', 'type'].some(k => S.runs[i][k] !== run[k])) { S.runs[i] = run; changed++ }
  }
  if (changed) {
    const cutoff = now - KEEP_DAYS * 86400e3
    S.runs = S.runs.filter(r => r && r.start >= cutoff).sort((a, b) => a.start - b.start)
  }
  return changed
}

/** The runs on one day, oldest first. */
export const runsOn = (S, iso) => (S?.runs || []).filter(r => r && r.d === iso)

/** Distance in the profile's unit (miles for an lb profile), one decimal; null without one. */
export function runDistance(run, unit) {
  if (!(run?.km > 0)) return null
  const v = unit === 'lb' ? run.km / KM_PER_MI : run.km
  return { value: Math.round(v * 100) / 100, unit: unit === 'lb' ? 'mi' : 'km' }
}

/** Pace per km (or per mile) as "m:ss"; null without a distance. */
export function runPace(run, unit) {
  const dist = runDistance(run, unit)
  if (!dist || !(run.end > run.start)) return null
  const secs = Math.round((run.end - run.start) / 1000 / dist.value)
  if (!Number.isFinite(secs) || secs <= 0 || secs > 3600) return null
  return { text: Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'), unit: dist.unit }
}
