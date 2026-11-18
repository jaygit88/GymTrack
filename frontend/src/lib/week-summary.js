// GymTrack's weekly summary: one short look back at a week (the profile's week start), shown on
// Home from the week's last day until two days into the next (components/WeekSummaryCard.jsx).
// Pure: state in, numbers out.
//
//   training   workouts, working sets, records, and the main muscles under or inside their
//              weekly set range (lib/muscle-targets.js)
//   running    runs and distance (lib/runs.js), and how many of your planned runs got done
//   food       the days you logged, the average day against the day's budget (target plus the
//              exercise you eat back, lib/nutrition.js dayBudget) and the protein target
//   weight     the week's average weigh-in against the week before's
import { isoOf, startOfWeek, weekStartOf, todayISO } from './format.js'
import { weeklyMuscleSets } from './muscle-targets.js'
import { setsDone } from './history.js'
import { runDistance } from './runs.js'
import { dayEntries, dayTotals, dayBudget, targetsOf } from './nutrition.js'
import { burnedOn } from './calories.js'
import { planThisWeek } from './running.js'

const LB_PER_KG = 2.2046226218
const shift = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const avg = list => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null)
const r1 = n => Math.round(n * 10) / 10

/** The week the summary is about on `today`: the current one on its last day, else the one before. */
export function summaryWeekFor(S, today = todayISO()) {
  const from = isoOf(startOfWeek(today, weekStartOf(S)))
  const last = shift(from, 6)
  if (today === last) return from
  const prev = shift(from, -7)
  return today <= shift(from, 1) ? prev : null
}

/** The summary of the week starting `from` (YYYY-MM-DD). */
export function weekSummary(S, from) {
  const to = shift(from, 7)
  const inWeek = d => d >= from && d < to
  const workouts = (S?.workouts || []).filter(w => w && inWeek(w.d))
  const sets = workouts.reduce((n, w) => n + setsDone(w), 0)
  const prs = workouts.reduce((n, w) => n + (Array.isArray(w.prs) ? w.prs.length : 0), 0)
  const muscles = workouts.length ? weeklyMuscleSets(S, from) : []
  const runs = (S?.runs || []).filter(r => r && inWeek(r.d))
  const km = runs.reduce((n, r) => n + (runDistance(r, 'kg')?.value || 0), 0)
  const plan = planThisWeek(S, S?.runPlan, new Date(from + 'T12:00:00').getTime() + 3 * 86400e3)
  const planned = plan && plan.from === from ? { done: plan.items.filter(i => i.done).length, of: plan.items.length } : null

  const days = Array.from({ length: 7 }, (_, i) => shift(from, i))
  const logged = days.filter(d => dayEntries(S, d).length)
  const tg = targetsOf(S)
  const food = logged.length ? {
    days: logged.length,
    kcal: Math.round(avg(logged.map(d => dayTotals(S, d).kcal))),
    budget: tg ? Math.round(avg(logged.map(d => dayBudget(S, d).total))) : null,
    protein: Math.round(avg(logged.map(d => dayTotals(S, d).protein))),
    proteinTarget: tg?.protein || null,
  } : null
  const burned = days.reduce((n, d) => n + burnedOn(S, d).total, 0)

  const toKg = w => (S?.unit === 'lb' ? w / LB_PER_KG : w)
  const weighIns = b => (S?.bodyweight || []).filter(x => x && +x.w > 0 && b(x.d)).map(x => +x.w)
  const now = weighIns(inWeek), before = weighIns(d => d >= shift(from, -7) && d < from)
  const weight = now.length ? {
    avg: r1(avg(now)),
    change: before.length ? r1(avg(now) - avg(before)) : null,
    changeKg: before.length ? r1(toKg(avg(now)) - toKg(avg(before))) : null,
  } : null

  return {
    from, to: shift(from, 6),
    training: { workouts: workouts.length, sets, prs,
      below: muscles.filter(m => m.status === 'below').map(m => m.name),
      inRange: muscles.filter(m => m.status === 'in').length, of: muscles.length },
    running: { runs: runs.length, km: r1(km), planned },
    food, burned, weight,
    empty: !workouts.length && !runs.length && !food && !weight,
  }
}
