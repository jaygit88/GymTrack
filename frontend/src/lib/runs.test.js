import { describe, it, expect } from 'vitest'
import { mergeRuns, runsOn, runDistance, runPace } from './runs.js'

const T = Date.parse('2026-11-10T07:00:00Z')
const sess = (over = {}) => ({ id: 'r1', origin: 'com.sec.android.app.shealth', start: T, end: T + 30 * 60e3, type: 'running', title: 'Morning run', meters: 5230, ...over })

describe('mergeRuns', () => {
  it('adds a run once, and updates it when the watch syncs its distance later', () => {
    const S = {}
    expect(mergeRuns(S, [sess({ meters: 0 })], { now: T + 3600e3 })).toBe(1)
    expect(S.runs).toHaveLength(1)
    expect(S.runs[0]).toMatchObject({ id: 'hc:r1', km: null, title: 'Morning run', d: '2026-11-10' })
    expect(mergeRuns(S, [sess({ meters: 0 })], { now: T + 3600e3 })).toBe(0)
    expect(mergeRuns(S, [sess()], { now: T + 3600e3 })).toBe(1)
    expect(S.runs).toHaveLength(1)
    expect(S.runs[0].km).toBe(5.23)
  })

  it('takes runs only, and never what openGym wrote itself', () => {
    const S = {}
    mergeRuns(S, [
      sess({ id: 'a', type: 'walking' }),
      sess({ id: 'b', type: 'strength_training' }),
      sess({ id: 'c', origin: 'com.jaygit88.gymtrack' }),
      sess({ id: 'd', clientId: 'opengym-w1' }),
      sess({ id: 'e', type: 'running_treadmill' }),
    ], { now: T + 3600e3 })
    expect(S.runs.map(r => r.id)).toEqual(['hc:e'])
  })

  it('leaves out mis-taps, forgotten sessions and runs in the future', () => {
    const S = {}
    mergeRuns(S, [
      sess({ id: 'short', end: T + 60e3 }),
      sess({ id: 'long', end: T + 10 * 3600e3 }),
      sess({ id: 'future', start: T + 7200e3, end: T + 9000e3 }),
    ], { now: T + 3600e3 })
    expect(S.runs).toEqual([])
  })

  it('drops runs older than the keep window when it writes', () => {
    const S = { runs: [{ id: 'hc:old', d: '2025-01-01', start: Date.parse('2025-01-01T08:00:00Z'), end: Date.parse('2025-01-01T08:30:00Z') }] }
    mergeRuns(S, [sess()], { now: T + 3600e3 })
    expect(S.runs.map(r => r.id)).toEqual(['hc:r1'])
  })
})

describe('reading a run back', () => {
  const run = { d: '2026-11-10', start: T, end: T + 30 * 60e3, km: 5 }
  it('lists a day', () => {
    expect(runsOn({ runs: [run] }, '2026-11-10')).toHaveLength(1)
    expect(runsOn({}, '2026-11-10')).toEqual([])
  })
  it('gives distance and pace in km, or miles for an lb profile', () => {
    expect(runDistance(run, 'kg')).toEqual({ value: 5, unit: 'km' })
    expect(runPace(run, 'kg')).toEqual({ text: '6:00', unit: 'km' })
    expect(runDistance(run, 'lb')).toEqual({ value: 3.11, unit: 'mi' })
    expect(runPace(run, 'lb').unit).toBe('mi')
    expect(runPace({ ...run, km: null }, 'kg')).toBeNull()
  })
})
