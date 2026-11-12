// GymTrack's quick workout: "I have 30 minutes, what should I do?" answered from your own log.
// Every area (the main muscle groups, plus upper chest, side delts and rear delts, which the
// muscle map does not split out) gets a need score from two things: how far its working sets over
// the last seven days fall short of its weekly target, and how long since it was last trained.
// Areas trained hard in the last two days are left to recover. The neediest areas get one
// exercise each, picked from what you have done before (so the weights are known), sized to the
// time you have. Pure: state in, a plan out. Starting it is sheets.jsx beginCustomWorkout.
import { EXIDX } from './exercises.js'
import { musclesOf, loadOfWorkouts, MUSCLE_NAME } from './muscles.js'
import { isWarmupRow } from './workout-model.js'
import { targetOf, TARGET_MUSCLES } from './muscle-targets.js'
import { exAvailable } from './equipment.js'

const DAY = 86400e3
// Minutes one working set takes with its rest: a big lift needs longer than an isolation move.
const MIN_PER_SET = { compound: 2.75, isolation: 2.25 }
// Warming up into the first lift.
const WARMUP_MIN = 3
// A muscle with this much load in the last 48 hours is still recovering.
const RECOVERING_LOAD = 4

// Areas the muscle map does not split out, recognised by exercise name or the catalogue's
// secondary muscles. `parent` is the muscle they belong to.
export const SUB_AREAS = [
  { key: 'upper-chest', label: 'Upper chest', parent: 'chest', target: 4, match: /incline|low[- ]?to[- ]?high|low fly/i, sm: 'upper chest', fallback: ['0314', '0047', '0179'] },
  { key: 'side-delts', label: 'Side delts', parent: 'deltoids', target: 6, match: /(?<!rear )lateral raise|side raise|upright row/i, fallback: ['0334', '0178'] },
  { key: 'rear-delts', label: 'Rear delts', parent: 'deltoids', target: 4, match: /rear delt|rear fly|reverse fly|face pull|rear lateral/i, sm: 'rear deltoids', fallback: ['0378', '3914', '11060'] },
]
// Well-known exercises for a muscle you have no history for, best first.
const FALLBACK = {
  chest: ['0289', '0025', '0662'], 'upper-back': ['0861', '0198', '0652', '0027'], deltoids: ['0405'],
  biceps: ['0294', '0313'], triceps: ['0201', '1605'], quadriceps: ['0739', '1760', '0043', '0585'],
  hamstring: ['1459', '0085', '0599', '0586'], gluteal: ['1060'], calves: ['0417', '0605'], abs: ['0175', '0274', '0472'],
}

const exOf = id => EXIDX[id] || null
const nameOf = ex => String(ex?.n || '')
// A big lift works several muscles hard; one-joint moves (curls, raises, flies, crunches) do not,
// whatever their secondary list says.
const ISOLATION = /curl|raise|fly|flye|extension|pushdown|push-down|crunch|kickback|shrug|pullover|face pull|twist|plank/i
const isCompound = ex => !ISOLATION.test(nameOf(ex)) && (Object.values(musclesOf(ex) || {}).filter(w => w >= 1).length >= 2 || Object.keys(musclesOf(ex) || {}).length >= 3)
const subOf = ex => SUB_AREAS.filter(a => a.match.test(nameOf(ex)) || (a.sm && (ex?.sm || []).includes(a.sm)))
const workingSets = e => (e?.sets || []).filter(s => s && s.done && !isWarmupRow(s)).length

/** The areas with their need: [{ key, label, muscle, sets7, target, days, recovering, score }], neediest first. */
export function areaNeeds(S, now = Date.now()) {
  const workouts = (S?.workouts || []).filter(w => w && w.d)
  const at = w => Number(w.start) || new Date(w.d + 'T12:00:00').getTime()
  const week = workouts.filter(w => at(w) > now - 7 * DAY)
  const recent = workouts.filter(w => at(w) > now - 2 * DAY)
  const load7 = loadOfWorkouts(week), load48 = loadOfWorkouts(recent)
  const lastFor = test => {
    let last = 0
    for (const w of workouts) for (const e of w.entries || []) if (workingSets(e) && test(e)) last = Math.max(last, at(w))
    return last
  }
  const score = (sets, target, last) => {
    const deficit = target > 0 ? Math.max(0, target - sets) / target : 0
    const days = last ? (now - last) / DAY : 14
    return Math.round((deficit * 0.6 + Math.min(1, days / 10) * 0.4) * 100) / 100
  }
  const out = []
  for (const m of TARGET_MUSCLES) {
    const [lo] = targetOf(S, m) || [8]
    const last = lastFor(e => (musclesOf(exOf(e.id) || e.exercise || e)[m] || 0) >= 1)
    out.push({ key: m, label: MUSCLE_NAME[m], muscle: m, sets7: Math.round((load7[m] || 0) * 10) / 10, target: lo,
      days: last ? Math.floor((now - last) / DAY) : null, recovering: (load48[m] || 0) >= RECOVERING_LOAD, score: score(load7[m] || 0, lo, last) })
  }
  for (const a of SUB_AREAS) {
    const hits = e => subOf(exOf(e.id) || e.exercise || e).some(x => x.key === a.key)
    const sets7 = week.reduce((n, w) => n + (w.entries || []).filter(hits).reduce((k, e) => k + workingSets(e), 0), 0)
    const last = lastFor(hits)
    out.push({ key: a.key, label: a.label, muscle: a.parent, sub: true, sets7, target: a.target,
      days: last ? Math.floor((now - last) / DAY) : null, recovering: (load48[a.parent] || 0) >= RECOVERING_LOAD, score: score(sets7, a.target, last) })
  }
  return out.sort((x, y) => y.score - x.score)
}

/** Exercise ids you have done in the last 90 days, most used first, with your usual reps. */
function yourExercises(S, now) {
  const use = new Map()
  for (const w of S?.workouts || []) {
    const at = w && (Number(w.start) || Date.parse(w.d + 'T12:00:00'))
    if (!w || !(at > now - 90 * DAY)) continue
    for (const e of w.entries || []) {
      const sets = (e.sets || []).filter(s => s && s.done && !isWarmupRow(s))
      if (!sets.length || !exOf(e.id)) continue
      const u = use.get(e.id) || { n: 0, reps: [] }
      u.n += 1
      for (const s of sets) if (+s.r > 0) u.reps.push(+s.r)
      use.set(e.id, u)
    }
  }
  return use
}
const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

/**
 * A workout that fits in `minutes`: [{ id, name, sets, reps, area: { key, label }, why: { sets7, target, days } }]
 * plus `estMinutes` and the areas left out because they are recovering. `shuffle` (0, 1, 2…) picks
 * each area's next-best exercise instead, for "show me something else".
 */
export function quickWorkout(S, minutes, { now = Date.now(), shuffle = 0 } = {}) {
  const budget = Math.max(10, Math.min(120, Number(minutes) || 30))
  const needs = areaNeeds(S, now)
  const recovering = [...new Set(needs.filter(a => a.recovering && !a.sub).map(a => a.label))]
  const yours = yourExercises(S, now)
  const ok = ex => ex && exAvailable(S, ex) && !Object.entries(musclesOf(ex)).some(([m, w]) => w >= 1 && needs.find(a => a.key === m)?.recovering)
  const candidates = area => {
    const fits = ex => (area.sub ? subOf(ex).some(x => x.key === area.key) : (musclesOf(ex)[area.key] || 0) >= 1 && !subOf(ex).length)
    const mine = [...yours.entries()].filter(([id]) => fits(exOf(id)) && ok(exOf(id))).sort((a, b) => b[1].n - a[1].n).map(([id]) => id)
    const fb = (area.sub ? SUB_AREAS.find(a => a.key === area.key).fallback : FALLBACK[area.key] || []).filter(id => ok(exOf(id)) && !mine.includes(id))
    return [...mine, ...fb]
  }
  const perEx = budget >= 45 ? 4 : 3
  const items = []
  const covered = new Set()
  let used = WARMUP_MIN
  // First one exercise per muscle group (upper chest counts as chest), then, with time left,
  // a second for the neediest groups.
  for (const second of [false, true]) {
    for (const area of needs) {
      if (area.recovering || area.score <= 0.05) continue
      const family = area.sub ? area.muscle : area.key
      if (!second && covered.has(family)) continue
      if (second && items.some(i => i.area.key === area.key)) continue
      const list = candidates(area).filter(id => !items.some(i => i.id === id))
      if (!list.length) continue
      const id = list[shuffle % list.length]
      const ex = exOf(id)
      const cost = MIN_PER_SET[isCompound(ex) ? 'compound' : 'isolation']
      let sets = perEx
      while (sets > 2 && used + sets * cost > budget) sets--
      if (used + sets * cost > budget) continue
      used += sets * cost
      covered.add(family)
      items.push({
        id, name: nameOf(ex), sets, reps: median(yours.get(id)?.reps || []) || (isCompound(ex) ? 8 : 12),
        compound: isCompound(ex), area: { key: area.key, label: area.label },
        why: { sets7: area.sets7, target: area.target, days: area.days },
      })
    }
  }
  // Big lifts first, while you are fresh.
  items.sort((a, b) => Number(b.compound) - Number(a.compound))
  return { minutes: budget, estMinutes: Math.round(used), items, recovering }
}
