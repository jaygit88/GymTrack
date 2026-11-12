import { describe, it, expect } from 'vitest'
import {
  summarizeRunDetail, fmtPace, fmtRaceTime, parseRaceTime, weeklyKm, loadWarning, raceEstimate,
  fitnessTrend, runGoalOf, goalProgress, planWeekIndex, planThisWeek, mergeFitness,
} from './running.js'

const T0 = Date.parse('2026-11-10T07:00:00')
const DAY = 86400e3

// A steady 5 km at 3.33 m/s (5:00 /km), sampled every 5 s, heart rate drifting from 140 to 150.
function steadyRun(over = {}) {
  const speed = [], hr = []
  for (let t = 0; t <= 1500; t += 5) { speed.push([T0 + t * 1000, 1000 / 300]); hr.push([T0 + t * 1000, 140 + Math.round(t / 150)]) }
  return { start: T0, end: T0 + 1500e3, meters: 5000, speed, hr, steps: 4250, elevation: 31.6, kcal: 402.4, ...over }
}

describe('summarizeRunDetail', () => {
  it('reads splits, heart rate, cadence, climb and energy from the samples', () => {
    const r = summarizeRunDetail(steadyRun())
    expect(r.splitsKm).toHaveLength(5)
    for (const s of r.splitsKm) expect(Math.abs(s - 300)).toBeLessThanOrEqual(2)
    expect(r.splitsMi).toHaveLength(3)
    expect(r.hr.avg).toBeGreaterThanOrEqual(144)
    expect(r.hr.avg).toBeLessThanOrEqual(146)
    expect(r.hr.max).toBe(150)
    expect(Object.values(r.hrb).reduce((a, b) => a + b, 0)).toBeGreaterThan(1450)
    expect(r.cadence).toBe(170)
    expect(r.elevM).toBe(32)
    expect(r.kcal).toBe(402)
    expect(r.eff).toBeCloseTo(5000 / (r.hr.avg * 25), 2)
    expect(r.dec).toBeGreaterThan(0)
    expect(r.dec).toBeLessThan(10)
  })

  it('takes whole-kilometre laps from the watch as the splits', () => {
    const laps = [[T0, T0 + 290e3, 1000], [T0 + 290e3, T0 + 600e3, 1000]]
    expect(summarizeRunDetail({ start: T0, end: T0 + 600e3, meters: 2000, laps }).splitsKm).toEqual([290, 310])
  })

  it('leaves out whatever was not saved', () => {
    expect(summarizeRunDetail({ start: T0, end: T0 + 1800e3, meters: 5000 })).toEqual({})
    expect(summarizeRunDetail({ start: T0, end: T0 + 1800e3, meters: 5000, steps: 50 }).cadence).toBeUndefined()
  })
})

describe('formatting', () => {
  it('writes and reads paces and race times', () => {
    expect(fmtPace(323)).toBe('5:23')
    expect(fmtPace(0)).toBeNull()
    expect(fmtRaceTime(1450)).toBe('24:10')
    expect(fmtRaceTime(6727)).toBe('1:52:07')
    expect(parseRaceTime('25:00')).toBe(1500)
    expect(parseRaceTime('1:55:00')).toBe(6900)
    expect(parseRaceTime('soon')).toBeNull()
  })
})

const run = (daysAgo, km, mins, extra = {}) => {
  const start = T0 - daysAgo * DAY
  return { id: 'r' + daysAgo + '-' + km, d: new Date(start).toISOString().slice(0, 10), start, end: start + mins * 60e3, km, ...extra }
}

describe('the weeks', () => {
  it('adds up each week, the current one last', () => {
    const S = { runs: [run(0, 5, 30), run(1, 3, 18), run(8, 10, 60)] }
    const w = weeklyKm(S, 3, T0 + 3600e3)
    expect(w).toHaveLength(3)
    expect(w[2]).toMatchObject({ km: 8, runs: 2 })
    expect(w[1]).toMatchObject({ km: 10, runs: 1 })
  })

  it('warns about a week far above the usual', () => {
    const usual = [run(10, 5, 30), run(17, 5, 30), run(24, 5, 30), run(12, 5, 30), run(19, 5, 30), run(26, 5, 30)]
    expect(loadWarning({ runs: [...usual, run(1, 10, 60)] }, T0 + 3600e3)).toBeNull()
    expect(loadWarning({ runs: [...usual, run(1, 10, 60), run(3, 8, 48)] }, T0 + 3600e3)).toMatchObject({ lastKm: 18, usualKm: 10 })
  })
})

describe('race estimate and goals', () => {
  it('scales the best recent run to the race distance', () => {
    const S = { runs: [run(3, 5, 25), run(5, 10, 55), run(60, 5, 20), run(2, 2, 8)] }
    const e = raceEstimate(S, 10, T0 + 3600e3)
    expect(Math.abs(e.secs - 1500 * Math.pow(2, 1.06))).toBeLessThan(2)
    expect(raceEstimate({ runs: [] }, 10, T0)).toBeNull()
  })

  it('cleans the goal', () => {
    expect(runGoalOf({})).toBeNull()
    expect(runGoalOf({ runGoal: { kind: 'fitness', weeklyKm: 15 } })).toEqual({ kind: 'fitness', weeklyKm: 15 })
    expect(runGoalOf({ runGoal: { kind: 'race', raceKm: 21.0975, targetSecs: 6900 } })).toMatchObject({ raceKm: 21.0975, targetSecs: 6900 })
    expect(runGoalOf({ runGoal: { kind: 'race' } })).toBeNull()
  })

  it('a race goal stalls when the estimate is no faster than a month ago', () => {
    const S = { runGoal: { kind: 'race', raceKm: 5, targetSecs: 1440 }, runs: [run(2, 5, 26), run(33, 5, 26)] }
    const p = goalProgress(S, T0 + 3600e3)
    expect(p.estimate.secs).toBe(1560)
    expect(p.toGo).toBe(120)
    expect(p.stalled).toBe(true)
    S.runs.push(run(1, 5, 25))
    expect(goalProgress(S, T0 + 3600e3).stalled).toBe(false)
  })

  it('a fitness goal reads the weekly average and whether running got more efficient', () => {
    const now = run(0, 0, 0).start + 3600e3
    const S = { runGoal: { kind: 'fitness', weeklyKm: 10 }, runs: [
      run(2, 5, 30, { eff: 1.2 }), run(9, 5, 30, { eff: 1.2 }), run(16, 5, 30, { eff: 1.2 }),
      run(35, 5, 30, { eff: 1.2 }), run(40, 5, 30, { eff: 1.2 }), run(45, 5, 30, { eff: 1.2 }),
    ] }
    const p = goalProgress(S, now)
    expect(p.avgKm).toBeGreaterThan(0)
    expect(p.stalled).toBe(true)
    S.runs[0].eff = 1.5
    expect(goalProgress(S, now).stalled).toBe(false)
  })

  it('reads the trend of resting heart rate and VO2 max', () => {
    const S = { fitness: { rhr: [{ d: '2026-09-25', bpm: 62 }, { d: '2026-11-05', bpm: 58 }], vo2: [{ d: '2026-11-01', v: 45.2 }] } }
    const tr = fitnessTrend(S, T0)
    expect(tr.rhr).toEqual({ now: 58, before: 62 })
    expect(tr.vo2.now).toBe(45.2)
  })
})

describe('the plan', () => {
  const plan = { startsOn: '2026-11-09', weeks: [
    { runs: [{ kind: 'easy', km: 5 }, { kind: 'long', km: 10 }, { kind: 'intervals', km: 6 }] },
    { runs: [{ kind: 'easy', km: 5 }] },
  ] }
  it('finds the week and ticks the planned runs that were done, by distance', () => {
    expect(planWeekIndex(plan, Date.parse('2026-11-08T12:00:00'))).toBe(-1)
    expect(planWeekIndex(plan, Date.parse('2026-11-17T12:00:00'))).toBe(1)
    const S = { runs: [run(0, 9.4, 55), run(1, 4.8, 28), run(-1, 2, 12)] }
    const w = planThisWeek(S, plan, T0 + 3600e3)
    expect(w.index).toBe(0)
    expect(w.items.map(i => !!i.done)).toEqual([true, true, false])
    expect(w.extra).toBe(1)
  })
})

describe('mergeFitness', () => {
  it('keeps one reading a day, the latest, and drops nonsense', () => {
    const S = {}
    expect(mergeFitness(S, { vo2max: [[T0, 44.31], [T0 + 3600e3, 44.8], [T0, 400]], restingHr: [[T0, 59], [T0, 5]] }, T0 + 7200e3)).toBe(3)
    expect(S.fitness.vo2).toEqual([{ d: '2026-11-10', t: T0 + 3600e3, v: 44.8 }])
    expect(S.fitness.rhr).toHaveLength(1)
    expect(mergeFitness(S, { vo2max: [[T0 + 3600e3, 44.8]] }, T0 + 7200e3)).toBe(0)
  })
})
