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
 * The calories of one workout, rounded to 5: { kcal, avgHr, minutes } or { kcal: null, missing }
 * where `missing` says what is needed ('hr', 'age', 'weight' or 'time').
 */
export function workoutCalories(S, w) {
  const avg = Number(w?.hr?.avg)
  if (!(avg >= HR_MIN && avg <= HR_MAX)) return { kcal: null, missing: 'hr' }
  const minutes = (Number(w?.end) - Number(w?.start)) / 60000
  if (!(minutes >= 5)) return { kcal: null, missing: 'time' }
  const age = ageOf(S, new Date(w.d + 'T12:00:00').getFullYear())
  if (!age) return { kcal: null, missing: 'age' }
  const kg = weightKgFor(S, w)
  if (!kg) return { kcal: null, missing: 'weight' }
  const female = (sexOf(S) || (S?.body === 'female' ? 'female' : 'male')) === 'female'
  const perMin = female
    ? (-20.4022 + 0.4472 * avg - 0.1263 * kg + 0.074 * age) / 4.184
    : (-55.0969 + 0.6309 * avg + 0.1988 * kg + 0.2017 * age) / 4.184
  const kcal = Math.max(0, perMin * Math.min(minutes, MAX_MIN))
  return { kcal: Math.round(kcal / 5) * 5, avgHr: Math.round(avg), minutes: Math.round(minutes) }
}

/**
 * The calories of one run: what the watch saved for it (Samsung Health's active calories, read
 * through Health Connect), else worked out from its heart rate like a workout. Null when neither.
 */
export function runCalories(S, r) {
  if (Number(r?.kcal) > 0) return Math.round(Number(r.kcal) / 5) * 5
  return workoutCalories(S, { d: r?.d, start: r?.start, end: r?.end, hr: r?.hr }).kcal
}

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
