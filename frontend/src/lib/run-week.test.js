import { describe, it, expect } from 'vitest'
import { setRunDay, removeRunDay, runWeekOn, runsPlannedOn, planThisWeek, runDaysForModel } from './running.js'

const at = iso => new Date(iso + 'T12:00:00').getTime()

describe('your own run days', () => {
  it('adds, moves and removes placeholders by weekday', () => {
    const S = {}
    setRunDay(S, 2, 'a', { kind: 'easy', km: '5' })
    setRunDay(S, 6, 'b', { kind: 'long', km: null, notes: '  slow  ' })
    expect(runWeekOn(S, 2)).toEqual([{ id: 'a', kind: 'easy', km: 5 }])
    expect(runWeekOn(S, 6)).toEqual([{ id: 'b', kind: 'long', km: null, notes: 'slow' }])
    setRunDay(S, 4, 'a', { kind: 'tempo', km: 6 })                 // moved to Thursday
    expect(runWeekOn(S, 2)).toEqual([])
    expect(runWeekOn(S, 4)[0]).toMatchObject({ id: 'a', kind: 'tempo', km: 6 })
    expect(runDaysForModel(S)).toEqual({ Thu: ['tempo 6 km'], Sat: ['long'] })
    removeRunDay(S, 'a'); removeRunDay(S, 'b')
    expect(S.runWeek).toEqual({})
    expect(runDaysForModel(S)).toBeNull()
  })

  it('a date shows your run days, unless a GymTrackAI plan covers that week', () => {
    const S = { runWeek: { 3: [{ id: 'a', kind: 'easy', km: 5 }] } }
    expect(runsPlannedOn(S, '2026-11-18')).toEqual([{ day: 'Wed', kind: 'easy', km: 5, own: true }])   // a Wednesday
    S.runPlan = { startsOn: '2026-11-16', weeks: [{ runs: [{ day: 'Thu', kind: 'tempo', km: 6 }] }] }
    expect(runsPlannedOn(S, '2026-11-18')).toEqual([])
    expect(runsPlannedOn(S, '2026-11-19')[0]).toMatchObject({ kind: 'tempo' })
    expect(runsPlannedOn(S, '2026-11-25')).toEqual([{ day: 'Wed', kind: 'easy', km: 5, own: true }])   // after the plan
  })

  it('this week ticks a run day by distance, or by its day when it has none', () => {
    const S = {
      weekStart: 1,
      runWeek: { 2: [{ id: 'a', kind: 'easy', km: 5 }], 6: [{ id: 'b', kind: 'long', km: null }] },
      runs: [{ id: 'r1', start: at('2026-11-17'), km: 5.3 }],
    }
    const w = planThisWeek(S, null, at('2026-11-18'))
    expect(w.own).toBe(true)
    expect(w.from).toBe('2026-11-16')
    expect(w.items.map(i => [i.day, i.kind, i.done])).toEqual([['Tue', 'easy', 'r1'], ['Sat', 'long', null]])
    S.runs.push({ id: 'r2', start: at('2026-11-21'), km: 14 })
    expect(planThisWeek(S, null, at('2026-11-21')).items[1].done).toBe('r2')
    expect(planThisWeek({}, null, at('2026-11-18'))).toBeNull()
  })
})
