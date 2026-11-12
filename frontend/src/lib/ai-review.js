// GymTrack's Claude reviews: a summary of the last month with suggestions for the next one, and
// suggestions for measurement goals that stopped improving (lib/measure-change.js stalledGoals).
// Pure: state in, a compact payload and prompt out, and the model's answer checked on the way
// back. The call itself goes through the AI Coach's own connection (lib/ai-review-run.js), with
// the user's own key on the phone.
//
// What goes to the model is a summary, not the log: per workout its date, name, length, sets and
// each exercise's best set; runs with distance and time; body weight at the ends of the month; the
// measurement changes and the goals. No names, no notes, no photos, no health data beyond that.
import { EXIDX } from './exercises.js'
import { isWarmupRow } from './workout-model.js'
import { measurementChanges, goalKeys, stalledGoals } from './measure-change.js'
import { MEASUREMENT_FIELDS } from './measurements.js'
import { runDistance } from './runs.js'
import { isoOf } from './format.js'

export const REVIEW_MODES = ['month', 'stall']
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
  const runs = (S?.runs || []).filter(r => r && r.d > from && r.d <= to).map(r => {
    const dist = runDistance(r, S.unit)
    return { date: r.d, minutes: Math.round((r.end - r.start) / 60000), ...(dist ? { distance: `${dist.value} ${dist.unit}` } : {}) }
  })
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
  }
}

const RULES = {
  month: [
    'You review one person\'s last month of training for their own gym app and suggest what to do next month.',
    'Read the JSON payload: their workouts (with each exercise\'s best set), runs, body weight, body measurement changes, and the measurements they are working on (goals), including any that stalled.',
    'Write "summary": two to four plain sentences on how the month went: consistency against the period before, what they trained most and least, strength trends you can see, runs, and how the goal measurements moved.',
    'Write "highlights": up to four short things that went well, each one line.',
    'Write "suggestions": three to five concrete changes for next month, each with a short "title" and a one or two sentence "why" that points at the data. Prefer training changes (volume per muscle, exercise choice, frequency, progression, running mix) and mention food or sleep only where a goal clearly calls for it.',
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
  'Return exactly one JSON object and nothing else: {"summary": string, "highlights": [string], "suggestions": [{"title": string, "why": string}]}.',
]

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
    system: [...RULES[mode], ...COMMON, `Write in ${langName}. Weights are in ${payload?.unit || 'kg'}.`].join('\n'),
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
