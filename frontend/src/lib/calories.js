// GymTrack: calories a workout burned, worked out on the phone from the heart rate your watch
// measured (the workout's average, lib/heart-rate.js), how long it lasted, your weight that day,
// and the age and sex in Settings, About you (lib/strength-level.js). Keytel's formula (Journal of
// Sports Sciences, 2005), the one most watches start from:
//   men    kcal/min = (-55.0969 + 0.6309 HR + 0.1988 kg + 0.2017 age) / 4.184
//   women  kcal/min = (-20.4022 + 0.4472 HR - 0.1263 kg + 0.074 age) / 4.184
// An estimate, shown with "≈": good for comparing your sessions, not to the last calorie. No heart
// rate, no age or no weight means no number, never a guess.
import { ageOf, sexOf } from './strength-level.js'

const LB_PER_KG = 2.2046226218
// The formula was fitted on moving exercise; below this the heart is barely above resting and it
// gives nothing useful, above this it is a sensor glitch.
const HR_MIN = 80
const HR_MAX = 210
// A session someone forgot to stop is not four hours of burning.
const MAX_MIN = 180
// The age used until one is set in Settings, About you.
const DEFAULT_AGE = 35

/**
 * Your weight in kg for a workout: its own weigh-in, else the latest one on or before its day,
 * else the first one after it. Weight moves slowly, so any weigh-in (yours, or Samsung Health's
 * through Health Connect) is close enough; only a profile with none at all has no weight.
 */
export function weightKgFor(S, w) {
  const toKg = v => (S?.unit === 'lb' ? v / LB_PER_KG : v)
  if (+w?.bw > 0) return toKg(+w.bw)
  const all = (S?.bodyweight || []).filter(b => b && b.d && +b.w > 0)
  const before = all.filter(b => b.d <= w?.d)
  if (before.length) return toKg(+before[before.length - 1].w)
  return all.length ? toKg(+all[0].w) : null
}

/**
 * A workout's heart rate: the session's own (the watch's, or Health Connect's), else worked out
 * from the readings on its sets: their average, the rests' too when the watch measured them. Sets
 * alone run high (the heart is up while lifting, lower between), so without rests they count at
 * 92 %. Null with fewer than three sets measured.
 */
export function sessionHrOf(w) {
  const own = w?.hr
  if (Number(own?.avg) > 0) return { avg: Math.round(own.avg), max: Math.round(Number(own.max) || own.avg), from: 'session' }
  const sets = [], rests = [], maxes = []
  for (const e of w?.entries || []) for (const s of e?.sets || []) {
    if (Number(s?.hr?.avg) > 0) { sets.push(Number(s.hr.avg)); maxes.push(Number(s.hr.max) || 0) }
    if (Number(s?.restHr?.avg) > 0) rests.push(Number(s.restHr.avg))
  }
  if (sets.length < 3) return null
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length
  const avg = rests.length ? mean([...sets, ...rests]) : mean(sets) * 0.92
  return { avg: Math.round(avg), max: Math.max(...maxes, Math.round(avg)), from: 'sets' }
}

/**
 * The calories of one workout, rounded to 5: { kcal, avgHr, minutes } or { kcal: null, missing }
 * where `missing` says what is needed ('hr', 'age', 'weight' or 'time').
 */
export function workoutCalories(S, w) {
  const avg = Number(sessionHrOf(w)?.avg)
  if (!(avg >= HR_MIN && avg <= HR_MAX)) return { kcal: null, missing: 'hr' }
  const minutes = (Number(w?.end) - Number(w?.start)) / 60000
  if (!(minutes >= 5)) return { kcal: null, missing: 'time' }
  // Without a year of birth, 35: age moves the formula by only about 1 % a decade, and no number
  // at all helped nobody. `assumed` says so, for a hint to add it.
  const known = ageOf(S, new Date(w.d + 'T12:00:00').getFullYear())
  const age = known || DEFAULT_AGE
  const kg = weightKgFor(S, w)
  if (!kg) return { kcal: null, missing: 'weight' }
  const female = (sexOf(S) || (S?.body === 'female' ? 'female' : 'male')) === 'female'
  const perMin = female
    ? (-20.4022 + 0.4472 * avg - 0.1263 * kg + 0.074 * age) / 4.184
    : (-55.0969 + 0.6309 * avg + 0.1988 * kg + 0.2017 * age) / 4.184
  const kcal = Math.max(0, perMin * Math.min(minutes, MAX_MIN))
  return { kcal: Math.round(kcal / 5) * 5, avgHr: Math.round(avg), minutes: Math.round(minutes), ...(known ? {} : { assumed: 'age' }) }
}

/**
 * The calories of one run and where they came from: { kcal, from: 'watch' | 'total' | 'hr' } or
 * { kcal: null, missing }. In order: the active calories the watch saved; its total calories with
 * the resting part taken off (about 1 kcal per kg of body weight an hour, 1.2 kcal a minute
 * without a weigh-in); else worked out from the run's heart rate like a workout. `missing` is
 * 'calories' (nothing saved and no heart rate), or what the heart-rate way lacks: 'weight', 'age'.
 */
export function runCalorieInfo(S, r) {
  const round = k => Math.round(k / 5) * 5
  if (Number(r?.kcal) > 0) return { kcal: round(Number(r.kcal)), from: 'watch' }
  const minutes = (Number(r?.end) - Number(r?.start)) / 60000
  if (Number(r?.kcalTotal) > 0 && minutes > 0) {
    const kg = weightKgFor(S, { d: r.d })
    const resting = (kg ? kg / 60 : 1.2) * Math.min(minutes, MAX_MIN)
    const k = Number(r.kcalTotal) - resting
    if (k > 0) return { kcal: round(k), from: 'total' }
  }
  const est = workoutCalories(S, { d: r?.d, start: r?.start, end: r?.end, hr: r?.hr })
  if (est.kcal) return { kcal: est.kcal, from: 'hr', ...(est.assumed ? { assumed: est.assumed } : {}) }
  return { kcal: null, missing: est.missing === 'hr' ? 'calories' : est.missing }
}
export const runCalories = (S, r) => runCalorieInfo(S, r).kcal

/** Exercise you added by hand for a day (S.exerciseLog): [{ id, name, kcal, at }]. */
export const extraOn = (S, iso) => (S?.exerciseLog?.[iso] || []).filter(x => x && Number(x.kcal) > 0)

/** What a day burned in exercise: { workouts, runs, other, total } in kcal. */
export function burnedOn(S, iso) {
  const workouts = (S?.workouts || []).filter(w => w && w.d === iso).reduce((n, w) => n + (workoutCalories(S, w).kcal || 0), 0)
  const runs = (S?.runs || []).filter(r => r && r.d === iso).reduce((n, r) => n + (runCalories(S, r) || 0), 0)
  const other = extraOn(S, iso).reduce((n, x) => n + Math.round(Number(x.kcal)), 0)
  return { workouts, runs, other, total: workouts + runs + other }
}

/** S.exerciseLog with one more entry for `iso` (mutates S). */
export function addExtra(S, iso, { id, name, kcal, at = Date.now() }) {
  const k = Math.round(Number(kcal))
  if (!(k > 0 && k <= 5000)) return
  if (!S.exerciseLog || typeof S.exerciseLog !== 'object') S.exerciseLog = {}
  S.exerciseLog[iso] = [...extraOn(S, iso), { id, name: String(name || '').trim().slice(0, 60) || 'Exercise', kcal: k, at }]
}
export function removeExtra(S, iso, id) {
  if (!S.exerciseLog?.[iso]) return
  S.exerciseLog[iso] = S.exerciseLog[iso].filter(x => x && x.id !== id)
  if (!S.exerciseLog[iso].length) delete S.exerciseLog[iso]
}
