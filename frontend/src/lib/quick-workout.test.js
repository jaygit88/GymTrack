import { describe, it, expect } from 'vitest'
import { areaNeeds, quickWorkout } from './quick-workout.js'

const NOW = Date.parse('2026-11-12T18:00:00')
const DAY = 86400e3
const set = (w, r) => ({ w, r, done: true })
const wk = (daysAgo, entries) => ({ id: 'w' + daysAgo, d: new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10), start: NOW - daysAgo * DAY, end: NOW - daysAgo * DAY + 3600e3, entries })
const ex = (id, n = 3, r = 8) => ({ id, sets: Array.from({ length: n }, () => set(60, r)) })

// Flat bench and rows twice a week, legs four days ago, incline press last 12 days ago.
const S = { unit: 'kg', workouts: [
  wk(12, [ex('0314', 3, 10)]),
  wk(6, [ex('0025', 4), ex('0861', 4), ex('0334', 3, 12)]),
  wk(4, [ex('0739', 4, 10), ex('1459', 3, 10)]),
  wk(1, [ex('0025', 4), ex('0861', 4)]),
] }

describe('areaNeeds', () => {
  it('scores how far under target and how long ago each area was trained', () => {
    const needs = areaNeeds(S, NOW)
    const upper = needs.find(a => a.key === 'upper-chest')
    expect(upper).toMatchObject({ sets7: 0, target: 4, days: 12 })
    const chest = needs.find(a => a.key === 'chest')
    expect(chest.recovering).toBe(true)
    expect(needs.find(a => a.key === 'quadriceps').recovering).toBe(false)
    expect(needs[0].score).toBeGreaterThanOrEqual(needs[needs.length - 1].score)
  })
})

describe('quickWorkout', () => {
  it('fits the time, leaves recovering muscles alone and starts with the big lifts', () => {
    const q = quickWorkout(S, 30, { now: NOW })
    expect(q.estMinutes).toBeLessThanOrEqual(30)
    expect(q.items.length).toBeGreaterThanOrEqual(3)
    expect(q.recovering).toContain('Chest')
    // chest and back were trained yesterday: nothing that leans on them
    expect(q.items.some(i => i.id === '0025' || i.id === '0861' || i.id === '0314')).toBe(false)
    const compoundsFirst = q.items.map(i => i.compound)
    expect(compoundsFirst).toEqual([...compoundsFirst].sort((a, b) => Number(b) - Number(a)))
  })

  it('picks what you know, with your usual reps', () => {
    const q = quickWorkout({ ...S, workouts: S.workouts.filter(w => w.id !== 'w1') }, 45, { now: NOW })
    const upper = q.items.find(i => i.area.key === 'upper-chest')
    expect(upper).toMatchObject({ id: '0314', reps: 10 })
    expect(upper.why.days).toBe(12)
  })

  it('a longer session holds more, and a shuffle swaps exercises', () => {
    const short = quickWorkout(S, 15, { now: NOW }), long = quickWorkout(S, 60, { now: NOW })
    expect(long.items.reduce((n, i) => n + i.sets, 0)).toBeGreaterThan(short.items.reduce((n, i) => n + i.sets, 0))
    const again = quickWorkout(S, 60, { now: NOW, shuffle: 1 })
    expect(again.items.map(i => i.id)).not.toEqual(long.items.map(i => i.id))
  })

  it('works on an empty log with well-known exercises', () => {
    const q = quickWorkout({ workouts: [] }, 30, { now: NOW })
    expect(q.items.length).toBeGreaterThan(2)
    expect(q.recovering).toEqual([])
  })
})
