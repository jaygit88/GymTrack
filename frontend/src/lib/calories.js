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

/** Your weight in kg for a workout: its own weigh-in, else the latest one on or before its day. */
export function weightKgFor(S, w) {
  const toKg = v => (S?.unit === 'lb' ? v / LB_PER_KG : v)
  if (+w?.bw > 0) return toKg(+w.bw)
  const before = (S?.bodyweight || []).filter(b => b && b.d && b.d <= w?.d && +b.w > 0)
  return before.length ? toKg(+before[before.length - 1].w) : null
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
