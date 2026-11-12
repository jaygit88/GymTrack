import { describe, it, expect } from 'vitest'
import { buildReviewPayload, buildReviewPrompt, checkReview, storedReview } from './ai-review.js'

const NOW = Date.parse('2026-11-12T12:00:00Z')
const day = n => new Date(NOW - n * 86400e3).toISOString().slice(0, 10)
const S = {
  unit: 'kg',
  workouts: [
    { id: 'a', d: day(3), name: 'Push', start: 1, end: 1 + 50 * 60e3, prs: [{}], entries: [
      { id: 'nope-not-in-catalogue', name: 'Bench press', sets: [{ w: 20, r: 10, done: true, warmup: true }, { w: 80, r: 8, done: true }, { w: 85, r: 5, done: true }, { w: 90, r: 3, done: false }] },
    ] },
    { id: 'b', d: day(40), name: 'Old', entries: [] },
    { id: 'c', d: day(45), name: 'Older', entries: [] },
  ],
  runs: [{ id: 'hc:1', d: day(2), start: 0, end: 30 * 60e3, km: 5 }],
  bodyweight: [{ d: day(20), w: 82 }, { d: day(1), w: 81.2 }],
  measurements: [
    { d: day(40), t: 0, other: [], chest: 100, waist: 90 },
    { d: day(2), t: 0, other: [], chest: 100, waist: 88 },
  ],
}

describe('buildReviewPayload', () => {
  const p = buildReviewPayload(S, { now: NOW })
  it('summarises the month, not the log', () => {
    expect(p.period).toMatchObject({ to: '2026-11-12', days: 30 })
    expect(p.workoutCount).toBe(1)
    expect(p.previousPeriodWorkoutCount).toBe(2)
    expect(p.workouts[0]).toMatchObject({ name: 'Push', minutes: 50, sets: 2, prs: 1 })
    expect(p.workouts[0].exercises[0]).toEqual({ name: 'Bench press', sets: 2, best: '80 kg x 8' })
  })
  it('carries runs, body weight, measurement changes, goals and the stalled ones', () => {
    expect(p.runs).toEqual([{ date: day(2), minutes: 30, distance: '5 km' }])
    expect(p.bodyweight).toEqual({ first: '82 kg', last: '81.2 kg' })
    expect(p.measurementChanges.find(c => c.measurement === 'Waist')).toMatchObject({ verdict: 'better' })
    expect(p.goals).toContain('Chest')
    expect(p.stalledGoals).toEqual(['Chest'])
  })
  it('sends nothing personal beyond training numbers', () => {
    const text = JSON.stringify(buildReviewPayload({ ...S, user: { name: 'Jay' }, coach: { profile: { age: 30 } } }, { now: NOW }))
    expect(text).not.toContain('Jay')
  })
})

describe('buildReviewPrompt', () => {
  it('asks for the month or for the stalled goals, in the app language', () => {
    const m = buildReviewPrompt({ mode: 'month', unit: 'kg' }, 'German')
    expect(m.system).toMatch(/last month of training/)
    expect(m.system).toMatch(/Write in German/)
    expect(buildReviewPrompt({ mode: 'stall' }).system).toMatch(/stopped improving/)
  })
})

describe('checkReview', () => {
  it('keeps a good answer, trimmed and bounded', () => {
    const r = checkReview({ summary: ' Good month. ', highlights: ['Bench up', 3, ''], suggestions: [{ title: 'More chest', why: 'Chest is flat.' }, { title: 'x' }] })
    expect(r).toEqual({ ok: true, review: { summary: 'Good month.', highlights: ['Bench up'], suggestions: [{ title: 'More chest', why: 'Chest is flat.' }] } })
    const many = checkReview({ summary: 's', highlights: [], suggestions: Array.from({ length: 9 }, (_, i) => ({ title: 't' + i, why: 'w' })) })
    expect(many.review.suggestions).toHaveLength(5)
  })
  it('refuses an answer without a summary or suggestions', () => {
    expect(checkReview(null).ok).toBe(false)
    expect(checkReview({ highlights: [], suggestions: [{ title: 't', why: 'w' }] }).ok).toBe(false)
    expect(checkReview({ summary: 's', suggestions: [] }).ok).toBe(false)
  })
})

describe('storedReview', () => {
  it('reads a saved review back, and nothing else', () => {
    const r = { at: 1, review: { summary: 's', highlights: [], suggestions: [] } }
    expect(storedReview({ aiReviews: { month: r } }, 'month')).toBe(r)
    expect(storedReview({ aiReviews: { month: { at: 1 } } }, 'month')).toBeNull()
    expect(storedReview({}, 'stall')).toBeNull()
  })
})
