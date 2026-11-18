import { describe, it, expect } from 'vitest'
import { weekSummary, summaryWeekFor } from './week-summary.js'

const at = iso => new Date(iso + 'T08:00:00').getTime()
const S = {
  unit: 'kg', weekStart: 1,
  nutritionTargets: { kcal: 2900, protein: 150 },
  workouts: [
    { id: 'w1', d: '2026-11-16', entries: [{ id: '0025', sets: [{ w: 80, r: 8, done: true }, { w: 80, r: 8, done: true }, { w: 80, r: 8, done: true }] }], prs: [{}] },
    { id: 'w2', d: '2026-11-19', entries: [{ id: '0025', sets: [{ w: 80, r: 8, done: true }] }] },
    { id: 'old', d: '2026-11-12', entries: [{ id: '0025', sets: [{ w: 80, r: 8, done: true }] }] },
  ],
  runs: [{ id: 'r1', d: '2026-11-18', start: at('2026-11-18'), end: at('2026-11-18') + 1800e3, km: 5.2, distanceM: 5200 }],
  runWeek: { 3: [{ id: 'p', kind: 'easy', km: 5 }], 6: [{ id: 'q', kind: 'long', km: 12 }] },
  foodLog: {
    '2026-11-16': [{ id: 'a', meal: 'lunch', n: { kcal: 2600, protein: 140 } }],
    '2026-11-17': [{ id: 'b', meal: 'lunch', n: { kcal: 3000, protein: 160 } }],
  },
  bodyweight: [{ d: '2026-11-10', w: 82 }, { d: '2026-11-12', w: 82.4 }, { d: '2026-11-17', w: 82.6 }, { d: '2026-11-20', w: 83 }],
}

describe('weekSummary', () => {
  it('adds up training, running, food and weight for the week', () => {
    const s = weekSummary(S, '2026-11-16')
    expect(s.from).toBe('2026-11-16')
    expect(s.to).toBe('2026-11-22')
    expect(s.training).toMatchObject({ workouts: 2, sets: 4, prs: 1 })
    expect(s.training.below).toContain('Lats & upper back')
    expect(s.running.runs).toBe(1)
    expect(s.running.planned).toEqual({ done: 1, of: 2 })
    expect(s.food).toEqual({ days: 2, kcal: 2800, budget: 2900, protein: 150, proteinTarget: 150 })
    expect(s.weight).toEqual({ avg: 82.8, change: 0.6, changeKg: 0.6 })
    expect(s.empty).toBe(false)
  })
  it('an empty week says so', () => {
    expect(weekSummary(S, '2026-10-05').empty).toBe(true)
  })
})

describe('summaryWeekFor', () => {
  it('shows this week on its last day, last week for two days after, then nothing', () => {
    expect(summaryWeekFor(S, '2026-11-22')).toBe('2026-11-16')    // Sunday
    expect(summaryWeekFor(S, '2026-11-23')).toBe('2026-11-16')    // Monday
    expect(summaryWeekFor(S, '2026-11-24')).toBe('2026-11-16')    // Tuesday
    expect(summaryWeekFor(S, '2026-11-25')).toBeNull()
    expect(summaryWeekFor({ weekStart: 0 }, '2026-11-21')).toBe('2026-11-15')   // a Sunday week ends on Saturday
  })
})
