import { describe, it, expect } from 'vitest'
import { workoutCalories, weightKgFor } from './calories.js'

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
})
