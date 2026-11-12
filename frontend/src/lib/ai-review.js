// GymTrack's Claude reviews: a summary of the last month with suggestions for the next one, and
// suggestions for measurement goals that stopped improving (lib/measure-change.js stalledGoals).
// Pure: state in, a compact payload and prompt out, and the model's answer checked on the way
// back. The call itself goes through the AI Coach's own connection (lib/ai-review-run.js), with
// the user's own key on the phone.
//
// What goes to the model is a summary, not the log: per workout its date, name, length, sets and
// each exercise's best set; runs with distance, time, pace, heart rate, cadence, climb and
// efficiency; resting heart rate and VO2 max; body weight at the ends of the month; the
// measurement changes and goals; the running goal and plan. No names, notes or photos.
//
// A third mode, 'runplan', asks for a running plan towards the running goal (lib/running.js),
// fitted around the lifting: its answer is a plan, checked by checkRunPlan, saved as S.runPlan.
import { EXIDX } from './exercises.js'
import { isWarmupRow } from './workout-model.js'
import { measurementChanges, goalKeys, stalledGoals } from './measure-change.js'
import { MEASUREMENT_FIELDS } from './measurements.js'
import { runDistance } from './runs.js'
import { isoOf, startOfWeek, weekStartOf } from './format.js'
import { loadOfWorkouts } from './muscles.js'
import { runGoalOf, goalProgress, fitnessTrend, weeklyKm, loadWarning, planThisWeek, fmtPace, fmtRaceTime, RUN_KINDS } from './running.js'

export const REVIEW_MODES = ['month', 'stall', 'runplan']
const LEG_MUSCLES = ['quadriceps', 'hamstring', 'gluteal', 'adductors', 'calves']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY = 86400e3
const MAX_WORKOUTS = 40
const MAX_EXERCISES = 12

const label = key => MEASUREMENT_FIELDS.find(f => f.key === key)?.label || key
const nameOf = e => EXIDX[e?.id]?.n || e?.exercise?.name || e?.name || e?.id || 'exercise'
const done = s => s && s.done && !isWarmupRow(s)

function workoutLine(w, unit) {
  const exercises = (w.entries || []).map(e => {
    const sets = (e.sets || []).filter(done)
    if (!sets.length) return null
    const best = sets.reduce((b, s) => ((+s.w || 0) * (+s.r || 0) > (+b.w || 0) * (+b.r || 0) ? s : b), sets[0])
    const top = best.w ? `${best.w} ${unit} x ${best.r || 0}` : best.r ? `${best.r} reps` : best.t ? `${best.t} s` : null
    return { name: nameOf(e), sets: sets.length, ...(top ? { best: top } : {}) }
  }).filter(Boolean).slice(0, MAX_EXERCISES)
  const minutes = w.end > w.start ? Math.round((w.end - w.start) / 60000) : null
  return { date: w.d, name: w.name || null, ...(minutes ? { minutes } : {}), sets: exercises.reduce((n, e) => n + e.sets, 0), prs: Array.isArray(w.prs) ? w.prs.length : 0, exercises }
}

/** What the model is told about the last `days` (30), ending today. */
export function buildReviewPayload(S, { mode = 'month', now = Date.now(), days = 30 } = {}) {
  const to = isoOf(new Date(now)), from = isoOf(new Date(now - days * DAY))
  const before = isoOf(new Date(now - 2 * days * DAY))
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const workouts = (S?.workouts || []).filter(w => w && w.d > from && w.d <= to)
  const prevCount = (S?.workouts || []).filter(w => w && w.d > before && w.d <= from).length
  const runs = (S?.runs || []).filter(r => r && r.d > from && r.d <= to).map(r => runLine(r, S))
  const bw = (S?.bodyweight || []).filter(b => b && b.d > from && b.d <= to && +b.w > 0)
  const changes = measurementChanges(S || {}, days).rows.map(r => ({
    measurement: label(r.key), change: `${r.display > 0 ? '+' : ''}${r.display} ${r.unit}`, verdict: r.verdict, since: r.since,
  }))
  const goals = goalKeys(S).map(label)
  const stalled = stalledGoals(S || {}, days).map(r => label(r.key))
  return {
    mode, period: { from, to, days }, unit,
    workouts: workouts.slice(-MAX_WORKOUTS).map(w => workoutLine(w, unit)),
    workoutCount: workouts.length, previousPeriodWorkoutCount: prevCount,
    runs,
    bodyweight: bw.length ? { first: `${bw[0].w} ${unit}`, last: `${bw[bw.length - 1].w} ${unit}` } : null,
    measurementChanges: changes, goals, stalledGoals: stalled,
    running: runningContext(S, now, mode === 'runplan' ? 56 : days),
  }
}

/** One run as the model reads it. */
function runLine(r, S) {
  const dist = runDistance(r, S?.unit)
  const mins = Math.round((r.end - r.start) / 60000)
  const per = dist && dist.value > 0 ? (r.end - r.start) / 1000 / dist.value : null
  return {
    date: r.d, minutes: mins,
    ...(dist ? { distance: `${dist.value} ${dist.unit}`, pace: `${fmtPace(per)} /${dist.unit}` } : {}),
    ...(r.hr ? { hrAvg: r.hr.avg, hrMax: r.hr.max } : {}),
    ...(r.cadence ? { cadence: r.cadence } : {}),
    ...(r.elevM != null ? { climbM: r.elevM } : {}),
    ...(r.eff ? { metresPerBeat: r.eff } : {}),
    ...(r.dec != null ? { decouplingPct: r.dec } : {}),
  }
}

/** The running side: goal and progress, weekly distance, fitness trend, the lifting week, the plan. */
function runningContext(S, now, days) {
  const goal = runGoalOf(S)
  const prog = goalProgress(S, now)
  const trend = fitnessTrend(S, now)
  const weeks = weeklyKm(S, 8, now).map(w => ({ weekOf: w.start, distanceKm: w.km, runs: w.runs }))
  // Which weekdays carried leg work over the last four weeks: where hard runs should not go.
  const legDays = {}, liftDays = {}
  for (const w of (S?.workouts || []).filter(w => w && w.start > now - 28 * DAY)) {
    const wd = WEEKDAYS[new Date(w.d + 'T12:00:00').getDay()]
    liftDays[wd] = (liftDays[wd] || 0) + 1
    const load = loadOfWorkouts([w])
    if (LEG_MUSCLES.reduce((n, m) => n + (load[m] || 0), 0) >= 4) legDays[wd] = (legDays[wd] || 0) + 1
  }
  const week = S?.runPlan ? planThisWeek(S, S.runPlan, now) : null
  const recent = (S?.runs || []).filter(r => r && r.start > now - days * DAY).map(r => runLine(r, S))
  return {
    goal: goal ? {
      kind: goal.kind,
      ...(goal.weeklyKm ? { weeklyKm: goal.weeklyKm } : {}),
      ...(goal.raceKm ? { raceKm: goal.raceKm, targetTime: fmtRaceTime(goal.targetSecs) } : {}),
      ...(goal.by ? { by: goal.by } : {}),
    } : null,
    progress: prog ? {
      averageKmPerWeek: prog.avgKm,
      ...(prog.estimate ? { estimatedRaceTime: fmtRaceTime(prog.estimate.secs) } : {}),
      stalled: prog.stalled,
    } : null,
    weeks, loadWarning: loadWarning(S, now),
    fitness: {
      metresPerBeat: { lastMonth: trend.eff.now && Math.round(trend.eff.now * 100) / 100, monthBefore: trend.eff.before && Math.round(trend.eff.before * 100) / 100 },
      restingHr: trend.rhr, vo2max: trend.vo2,
    },
    liftingWeekdays: liftDays, legDayWeekdays: legDays,
    ...(days > 30 ? { runs: recent } : {}),
    ...(week ? { planThisWeek: week.items.map(i => ({ day: i.day, kind: i.kind, km: i.km, done: !!i.done })) } : {}),
  }
}

const RULES = {
  month: [
    'You review one person\'s last month of training for their own gym app and suggest what to do next month.',
    'Read the JSON payload: their workouts (with each exercise\'s best set), runs, body weight, body measurement changes, and the measurements they are working on (goals), including any that stalled.',
    'Write "summary": two to four plain sentences on how the month went: consistency against the period before, what they trained most and least, strength trends you can see, runs, and how the goal measurements moved.',
    'Write "highlights": up to four short things that went well, each one line.',
    'Write "suggestions": three to five concrete changes for next month, each with a short "title" and a one or two sentence "why" that points at the data. Prefer training changes (volume per muscle, exercise choice, frequency, progression, running mix) and mention food or sleep only where a goal clearly calls for it.',
    'Cover running too, from "running": weekly distance, pace and heart rate, metres per heartbeat (higher is fitter), resting heart rate (lower is fitter), VO2 max, any load warning, and how this week of the running plan went.',
  ],
  runplan: [
    'You write a running plan for one person who also lifts weights for muscle size. Their app shows it as a weekly checklist.',
    'Read "running" in the JSON payload: their goal (kind "fitness": cardio fitness at a weekly distance while gaining muscle; kind "race": a race distance, maybe a target time and date), recent runs with pace and heart rate, weekly distance, fitness trend, and the weekdays they lift and train legs.',
    'Plan the next four weeks. Start near their current weekly distance and add no more than about 10 % a week; make week 4 an easier week. Keep most running easy (conversational, low heart rate). For a fitness goal: two or three runs a week, at most one hard session, nothing that eats into leg recovery. For a race goal: build towards the distance with one long run and one quality session a week.',
    'Put each run on a weekday ("Mon" to "Sun"). Keep hard runs (tempo, intervals) and long runs off leg days and off the day before them; easy runs may go on lifting days.',
    'Write "summary": two or three plain sentences on the idea of the plan and why it fits them. Write "weeks": four objects, each {"runs": [...]} with two to five runs; each run {"day", "kind" (one of easy, long, tempo, intervals, recovery), "km" (a number), "notes" (one short line: pace or heart-rate guidance, or the interval set)}.',
  ],
  stall: [
    'You help one person whose body measurement goals stopped improving. Their app flagged the goals listed in "stalledGoals" as not improving over the last month.',
    'Read the JSON payload: their workouts (with each exercise\'s best set), runs, body weight, and the measurement changes.',
    'Write "summary": one to three plain sentences on the likely reason each stalled goal is stuck, from the data (too little direct work, no progression in load, too much or too little food going by body weight, and so on).',
    'Write "highlights": an empty list, or up to two things that are going right and should be kept.',
    'Write "suggestions": two to five concrete changes for the next month aimed at the stalled goals, each with a short "title" and a one or two sentence "why". Name exercises, sets per week or loads where you can.',
  ],
}
const COMMON = [
  'Be specific and kind, never preachy. No medical advice; suggest seeing a professional only for pain or injury.',
  'If there is too little data to say something, say so in the summary rather than guessing.',
]
const SHAPE = {
  review: 'Return exactly one JSON object and nothing else: {"summary": string, "highlights": [string], "suggestions": [{"title": string, "why": string}]}.',
  runplan: 'Return exactly one JSON object and nothing else: {"summary": string, "weeks": [{"runs": [{"day": string, "kind": string, "km": number, "notes": string}]}]}.',
}

export const RUNPLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'weeks'],
  properties: {
    summary: { type: 'string' },
    weeks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['runs'], properties: {
      runs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['day', 'kind', 'km', 'notes'], properties: {
        day: { type: 'string', enum: WEEKDAYS }, kind: { type: 'string', enum: RUN_KINDS }, km: { type: 'number' }, notes: { type: 'string' },
      } } },
    } } },
  },
}
export const schemaFor = mode => (mode === 'runplan' ? RUNPLAN_SCHEMA : REVIEW_SCHEMA)

export const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'highlights', 'suggestions'],
  properties: {
    summary: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'why'], properties: { title: { type: 'string' }, why: { type: 'string' } } } },
  },
}

/** The system rules and the user message for one review, in the app's language. */
export function buildReviewPrompt(payload, langName = 'English') {
  const mode = REVIEW_MODES.includes(payload?.mode) ? payload.mode : 'month'
  return {
    system: [...RULES[mode], ...COMMON, SHAPE[mode === 'runplan' ? 'runplan' : 'review'], `Write in ${langName}. Weights are in ${payload?.unit || 'kg'}; running distances in km.`].join('\n'),
    user: 'Payload:\n```json\n' + JSON.stringify(payload) + '\n```',
  }
}

const clip = (s, n) => String(s).replace(/\s+/g, ' ').trim().slice(0, n)

/**
 * The model's answer, checked: a summary, up to five highlights and five suggestions, every text
 * plain and bounded. Returns { ok: true, review } or { ok: false, error }.
 */
export function checkReview(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'the answer was not an object' }
  if (typeof value.summary !== 'string' || !value.summary.trim()) return { ok: false, error: 'the answer has no summary' }
  const highlights = (Array.isArray(value.highlights) ? value.highlights : [])
    .filter(h => typeof h === 'string' && h.trim()).slice(0, 5).map(h => clip(h, 200))
  const suggestions = (Array.isArray(value.suggestions) ? value.suggestions : [])
    .filter(s => s && typeof s.title === 'string' && s.title.trim() && typeof s.why === 'string')
    .slice(0, 5).map(s => ({ title: clip(s.title, 100), why: clip(s.why, 400) }))
  if (!suggestions.length) return { ok: false, error: 'the answer has no suggestions' }
  return { ok: true, review: { summary: clip(value.summary, 900), highlights, suggestions } }
}

/** A review saved in S.aiReviews[mode]: what it was about, and when. */
export function storedReview(S, mode) {
  const r = S?.aiReviews?.[mode]
  return r && typeof r === 'object' && r.review && typeof r.review.summary === 'string' ? r : null
}

/**
 * A running plan from the model, checked: a summary and one to eight weeks of two to six runs,
 * each on a weekday, of a known kind, 0.5 to 45 km. Returns { ok: true, plan } or { ok: false, error }.
 */
export function checkRunPlan(value) {
  if (!value || typeof value !== 'object' || typeof value.summary !== 'string' || !value.summary.trim()) return { ok: false, error: 'the plan has no summary' }
  const weeks = (Array.isArray(value.weeks) ? value.weeks : []).slice(0, 8).map(w => ({
    runs: (Array.isArray(w?.runs) ? w.runs : []).filter(r => r && WEEKDAYS.includes(r.day) && RUN_KINDS.includes(r.kind) && Number(r.km) >= 0.5 && Number(r.km) <= 45)
      .slice(0, 6).map(r => ({ day: r.day, kind: r.kind, km: Math.round(Number(r.km) * 10) / 10, notes: clip(r.notes || '', 160) }))
      .sort((a, b) => (WEEKDAYS.indexOf(a.day) || 7) - (WEEKDAYS.indexOf(b.day) || 7)),
  })).filter(w => w.runs.length)
  if (!weeks.length) return { ok: false, error: 'the plan has no runs' }
  return { ok: true, plan: { summary: clip(value.summary, 600), weeks } }
}

/** The plan as it is saved: starting at the beginning of the current week. */
export function planToSave(S, plan, now = Date.now()) {
  const goal = runGoalOf(S)
  return { at: now, startsOn: isoOf(startOfWeek(isoOf(new Date(now)), weekStartOf(S))), goal, ...plan }
}
