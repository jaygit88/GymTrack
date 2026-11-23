import { describe, it, expect } from 'vitest'
import { workoutCalories, sessionHrOf, weightKgFor, runCalories, runCalorieInfo, burnedOn, addExtra, removeExtra, extraOn } from './calories.js'

const w = (over = {}) => ({ d: '2026-11-18', start: 0, end: 60 * 60e3, hr: { avg: 125, max: 160 }, ...over })
const S = (over = {}) => ({ unit: 'kg', sex: 'male', birthYear: 1988, bodyweight: [{ d: '2026-11-10', w: 85 }], ...over })

describe('workoutCalories', () => {
  it('works out an hour at 125 bpm for a 38-year-old 85 kg man', () => {
    // (-55.0969 + 0.6309*125 + 0.1988*85 + 0.2017*38) / 4.184 = 11.55 kcal/min -> 693, rounded to 695
    expect(workoutCalories(S(), w())).toEqual({ kcal: 695, avgHr: 125, minutes: 60 })
  })

  it('uses the women\'s formula, the workout\'s own weigh-in and lb', () => {
    const r = workoutCalories(S({ sex: 'female', unit: 'lb' }), w({ bw: 143.3 }))   // 65 kg
    // (-20.4022 + 0.4472*125 - 0.1263*65 + 0.074*38) / 4.184 = 7.19 kcal/min -> 432, rounded to 430
    expect(r.kcal).toBe(430)
  })

  it('says what is missing instead of guessing', () => {
    expect(workoutCalories(S(), w({ hr: null })).missing).toBe('hr')
    expect(workoutCalories(S(), w({ hr: { avg: 60 } })).missing).toBe('hr')
    expect(workoutCalories(S({ birthYear: null }), w()).missing).toBe('age')
    expect(workoutCalories(S({ bodyweight: [] }), w()).missing).toBe('weight')
    expect(workoutCalories(S(), w({ end: 2 * 60e3 })).missing).toBe('time')
  })

  it('does not count a forgotten session as hours of burning', () => {
    const long = workoutCalories(S(), w({ end: 6 * 3600e3 }))
    expect(long.kcal).toBe(2080)   // capped at 180 minutes: 11.55 x 180
  })

  it('takes the latest weigh-in on or before the day', () => {
    expect(weightKgFor(S({ bodyweight: [{ d: '2026-11-01', w: 84 }, { d: '2026-11-17', w: 86 }, { d: '2026-11-20', w: 90 }] }), w())).toBe(86)
  })

  it('falls back to the first weigh-in after the day, however far', () => {
    expect(weightKgFor(S({ bodyweight: [{ d: '2027-03-01', w: 85 }, { d: '2027-04-01', w: 87 }] }), w())).toBe(85)
    expect(weightKgFor(S({ bodyweight: [] }), w())).toBeNull()
  })
})

describe('runs and exercise added by hand', () => {
  it('a run uses the watch\'s calories, else its heart rate', () => {
    expect(runCalories(S(), { d: '2026-11-18', kcal: 512.4 })).toBe(510)
    expect(runCalories(S(), { d: '2026-11-18', start: 0, end: 60 * 60e3, hr: { avg: 125 } })).toBe(695)
    expect(runCalories(S(), { d: '2026-11-18', start: 0, end: 60 * 60e3 })).toBeNull()
  })

  it('a day adds up workouts, runs and what you added', () => {
    const st = S({ workouts: [w()], runs: [{ d: '2026-11-18', kcal: 300 }, { d: '2026-11-17', kcal: 999 }] })
    addExtra(st, '2026-11-18', { id: 'x', name: ' Padel ', kcal: 450 })
    addExtra(st, '2026-11-18', { id: 'y', name: '', kcal: 0 })            // nothing burned, not added
    expect(extraOn(st, '2026-11-18')).toEqual([expect.objectContaining({ id: 'x', name: 'Padel', kcal: 450 })])
    expect(burnedOn(st, '2026-11-18')).toEqual({ workouts: 695, runs: 300, other: 450, total: 1445 })
    removeExtra(st, '2026-11-18', 'x')
    expect(st.exerciseLog['2026-11-18']).toBeUndefined()
    expect(burnedOn({}, '2026-11-18').total).toBe(0)
  })
})

describe('sessionHrOf', () => {
  const set = (avg, rest) => ({ done: true, hr: { avg, max: avg + 10 }, ...(rest ? { restHr: { avg: rest, max: rest + 5 } } : {}) })
  it('takes the session\'s own reading first', () => {
    expect(sessionHrOf({ hr: { avg: 118, max: 160 }, entries: [{ sets: [set(140), set(140), set(140)] }] })).toEqual({ avg: 118, max: 160, from: 'session' })
  })
  it('works one out from the sets, discounting for rests it did not see', () => {
    expect(sessionHrOf({ entries: [{ sets: [set(130), set(140)] }, { sets: [set(150)] }] })).toEqual({ avg: 129, max: 160, from: 'sets' })
    expect(sessionHrOf({ entries: [{ sets: [set(130, 100), set(140, 110), set(150, 110)] }] }).avg).toBe(123)
    expect(sessionHrOf({ entries: [{ sets: [set(130), set(140)] }] })).toBeNull()
  })
  it('gives a workout without a session reading its calories', () => {
    const w = { d: '2026-11-18', start: 0, end: 60 * 60e3, entries: [{ sets: [set(136), set(136), set(136)] }] }
    expect(workoutCalories(S(), w).kcal).toBe(695)     // 136 x 0.92 = 125 bpm, as the hour above
  })
})

describe('runCalorieInfo', () => {
  const run = over => ({ d: '2026-11-18', start: 0, end: 30 * 60e3, ...over })
  it('takes the watch\'s active calories, then its total less the resting part, then the heart rate', () => {
    expect(runCalorieInfo(S(), run({ kcal: 312 }))).toEqual({ kcal: 310, from: 'watch' })
    // 85 kg at rest for 30 minutes: 85 / 60 x 30 = 42.5 kcal off 400
    expect(runCalorieInfo(S(), run({ kcalTotal: 400 }))).toEqual({ kcal: 360, from: 'total' })
    expect(runCalorieInfo(S({ bodyweight: [] }), run({ kcalTotal: 400 }))).toEqual({ kcal: 365, from: 'total' })
    expect(runCalorieInfo(S(), run({ hr: { avg: 150, max: 170 } })).from).toBe('hr')
  })
  it('says what is missing when there is no way to a number', () => {
    expect(runCalorieInfo(S(), run())).toEqual({ kcal: null, missing: 'calories' })
    expect(runCalorieInfo(S({ bodyweight: [] }), run({ hr: { avg: 150, max: 170 } }))).toEqual({ kcal: null, missing: 'weight' })
    expect(runCalorieInfo(S({ birthYear: null }), run({ hr: { avg: 150, max: 170 } }))).toEqual({ kcal: null, missing: 'age' })
  })
})
