// "Ask GymTrackAI": a short chat with Claude about whatever is on screen. Pure: the context the
// model reads for each screen, the prompt, and the check on its answer. lib/ai-review-run.js
// sends it through the AI Coach's own connection (your key, the same consent and daily cap).
//
// Screens:
//   nutrition  the day's food by meal, totals against targets, what is left, what that day's
//              workouts burned, your recipes and the foods you eat most, the week's average
//   exercise   one exercise (in a workout or not): its muscles and equipment, the sets done and
//              still to do today, and your last sessions of it
//   general    the last two weeks of workouts and runs, body weight and the food week
// Every screen also carries "you": age, sex, latest weight, measurement goals, running goal.
// The chat is not saved: it lives in the sheet and goes when you close it.
import { EXIDX, smOf } from './exercises.js'
import { isWarmupRow } from './workout-model.js'
import { workoutLine } from './ai-review.js'
import { burnedOn as burnedDay, extraOn } from './calories.js'
import { ageOf, sexOf } from './strength-level.js'
import { goalKeys } from './measure-change.js'
import { MEASUREMENT_FIELDS } from './measurements.js'
import { runGoalOf } from './running.js'
import { runDistance } from './runs.js'
import { MEALS, dayEntries, dayTotals, mealTotals, averages, targetsOf, recipeNutrients, recentFoods, nutritionSummary } from './nutrition.js'
import { isoOf } from './format.js'

export const CHAT_SCREENS = ['nutrition', 'exercise', 'general']
const DAY = 86400e3
const MAX_TURNS = 8
const MAX_QUESTION = 600
const MAX_ANSWER = 2000

const label = key => MEASUREMENT_FIELDS.find(f => f.key === key)?.label || key
const unitOf = S => (S?.unit === 'lb' ? 'lb' : 'kg')
const burnedOn = (S, iso) => burnedDay(S, iso).total

function you(S) {
  const bw = (S?.bodyweight || []).filter(b => b && +b.w > 0)
  const g = runGoalOf(S)
  return {
    ...(ageOf(S) ? { age: ageOf(S) } : {}), ...(sexOf(S) ? { sex: sexOf(S) } : {}),
    ...(bw.length ? { weight: `${bw[bw.length - 1].w} ${unitOf(S)}` } : {}),
    measurementGoals: goalKeys(S || {}).map(label),
    ...(g ? { runningGoal: g.kind === 'race' ? `race ${g.raceKm} km${g.by ? ' by ' + g.by : ''}` : `cardio fitness, ${g.weeklyKm} km a week` } : {}),
  }
}

function nutritionContext(S, iso) {
  const tot = dayTotals(S, iso), tg = targetsOf(S)
  const meals = {}
  for (const m of MEALS) {
    const list = dayEntries(S, iso).filter(e => e.meal === m)
    if (list.length) meals[m] = { kcal: mealTotals(S, iso, m).kcal, foods: list.map(e => `${e.name} (${e.n.kcal} kcal, ${e.n.protein} g protein)`) }
  }
  const week = averages(S, 7)
  const workoutsToday = (S?.workouts || []).filter(w => w && w.d === iso).map(w => w.name || 'workout')
  const runsToday = (S?.runs || []).filter(r => r && r.d === iso).map(r => { const d = runDistance(r, 'kg'); return d ? `run ${d.value} km` : 'run' })
  return {
    date: iso,
    eaten: { kcal: tot.kcal, proteinG: tot.protein, carbsG: tot.carbs, fatG: tot.fat },
    meals,
    ...(tg ? { targets: { kcal: tg.kcal, ...(tg.protein ? { proteinG: tg.protein } : {}) },
      left: { kcal: tg.kcal - tot.kcal, ...(tg.protein ? { proteinG: Math.round(tg.protein - tot.protein) } : {}) } } : {}),
    burnedInExerciseKcal: burnedDay(S, iso),
    trainedToday: [...workoutsToday, ...runsToday, ...extraOn(S, iso).map(x => `${x.name} (${x.kcal} kcal, added by hand)`)],
    recipes: (S?.recipes || []).slice(0, 15).map(r => { const n = recipeNutrients(r).perServing; return `${r.name} (${n.kcal} kcal, ${n.protein} g protein a serving)` }),
    foodsYouEat: recentFoods(S, 20).map(e => e.name),
    ...(week.days > 1 ? { last7DaysAverage: { daysLogged: week.days, kcal: week.avg.kcal, proteinG: week.avg.protein } } : {}),
  }
}

const setText = (s, unit) => (+s.w ? `${s.w} ${unit} x ${s.r || 0}` : +s.r ? `${s.r} reps` : +s.t ? `${s.t} s` : null)

function exerciseContext(S, exId, now) {
  const ex = EXIDX[exId] || (S?.customEx || []).find(c => c && c.id === exId) || null
  const unit = unitOf(S)
  const entry = (S?.active?.entries || []).find(e => e && e.id === exId)
  const work = (entry?.sets || []).filter(s => s && !isWarmupRow(s))
  const history = (S?.workouts || []).filter(w => w && (w.entries || []).some(e => e.id === exId))
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0)).slice(0, 6)
    .map(w => ({ date: w.d, sets: (w.entries.find(e => e.id === exId).sets || []).filter(s => s && s.done && !isWarmupRow(s)).map(s => setText(s, unit)).filter(Boolean) }))
    .filter(h => h.sets.length)
  return {
    name: ex?.n || ex?.name || entry?.name || exId,
    ...(ex?.bp ? { bodyPart: ex.bp } : {}), ...(ex?.eq ? { equipment: ex.eq } : {}),
    ...(ex?.tg ? { target: ex.tg } : {}), ...(ex && smOf(ex).length ? { secondary: smOf(ex) } : {}),
    ...(entry ? { today: {
      done: work.filter(s => s.done).map(s => setText(s, unit)).filter(Boolean),
      toDo: work.filter(s => !s.done).map(s => setText(s, unit)).filter(Boolean),
      ...(entry.note ? { note: String(entry.note).slice(0, 200) } : {}),
    } } : {}),
    lastSessions: history,
    daysSinceLast: history.length ? Math.round((now - new Date(history[0].date + 'T12:00:00').getTime()) / DAY) : null,
  }
}

function generalContext(S, now) {
  const from = isoOf(new Date(now - 14 * DAY)), unit = unitOf(S)
  const bw = (S?.bodyweight || []).filter(b => b && +b.w > 0 && b.d > isoOf(new Date(now - 30 * DAY)))
  return {
    last14Days: (S?.workouts || []).filter(w => w && w.d > from).slice(-20).map(w => workoutLine(w, unit, S)),
    runs: (S?.runs || []).filter(r => r && r.d > from).map(r => { const d = runDistance(r, 'kg'); return { date: r.d, km: d ? d.value : null, minutes: Math.round((r.end - r.start) / 60000), ...(r.hr?.avg ? { hrAvg: r.hr.avg } : {}) } }),
    ...(bw.length > 1 ? { weightLast30Days: { first: `${bw[0].w} ${unit}`, last: `${bw[bw.length - 1].w} ${unit}` } } : {}),
    ...(S?.active ? { inWorkoutNow: { name: S.active.name, exercises: (S.active.entries || []).map(e => EXIDX[e.id]?.n || e.name || e.id) } } : {}),
    nutrition7Days: nutritionSummary(S || {}, { days: 7, now, burnedOn: iso => burnedOn(S, iso) }),
  }
}

/** What the model reads for `screen` ('nutrition' with `iso`, 'exercise' with `exId`, or 'general'). */
export function chatContext(S, { screen = 'general', iso, exId, now = Date.now() } = {}) {
  const sc = CHAT_SCREENS.includes(screen) ? screen : 'general'
  const day = iso || isoOf(new Date(now))
  const base = { screen: sc, today: isoOf(new Date(now)), unit: unitOf(S), you: you(S) }
  if (sc === 'nutrition') return { ...base, nutrition: nutritionContext(S || {}, day) }
  if (sc === 'exercise' && exId) return { ...base, exercise: exerciseContext(S || {}, exId, now) }
  return { ...base, screen: 'general', recent: generalContext(S || {}, now) }
}

const RULES = [
  'You are GymTrackAI, the coach inside a personal gym, running and nutrition tracker. The person lifts for muscle size, runs for cardio fitness, and may train for a half marathon.',
  'You get "context": what is on their screen right now and their data. Answer the question from it, using their numbers. If the context does not hold what you need, say what is missing in a few words and still give your best general answer.',
  'Keep it short: at most about 120 words, plain sentences, or up to five lines starting with "- " for lists. No headings, no tables, no markdown bold.',
  'On food: suggest real meals with rough calories and protein that fit what is left of their day, prefer their own recipes and the foods they already eat, and weigh what they burned training. Never suggest eating under about 1,500 kcal a day.',
  'On an exercise: give concrete cues for getting more from it (setup, range of motion, tempo, where to feel it, the squeeze, common mistakes), and when asked about load, read their last sessions and today\'s sets.',
  'Be specific and kind, never preachy. No medical advice; for pain or injury suggest seeing a professional.',
  'Also give "followUps": up to three short questions they might ask next, in their words, each under 8 words.',
  'Return exactly one JSON object and nothing else: {"answer": string, "followUps": [string]}.',
]

export const CHAT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answer', 'followUps'],
  properties: { answer: { type: 'string' }, followUps: { type: 'array', items: { type: 'string' } } },
}

/** The prompt for one question, with the earlier turns of this chat (`history`: [{ role: 'you' | 'ai', text }]). */
export function buildChatPrompt(context, history, question, langName = 'English') {
  const turns = (history || []).filter(h => h && h.text).slice(-MAX_TURNS)
    .map(h => ({ [h.role === 'ai' ? 'gymtrackai' : 'you']: String(h.text).slice(0, MAX_ANSWER) }))
  return {
    system: [...RULES, `Write in ${langName}. Weights are in ${context?.unit || 'kg'}; distances in km.`].join('\n'),
    user: JSON.stringify({ context, earlierInThisChat: turns, question: String(question || '').trim().slice(0, MAX_QUESTION) }),
  }
}

/** The model's answer, checked: { ok, answer, followUps } with plain trimmed text. */
export function checkChat(v) {
  const answer = typeof v?.answer === 'string' ? v.answer.replace(/\*\*/g, '').replace(/\s*\u2014\s*/g, ', ').trim().slice(0, MAX_ANSWER) : ''
  if (!answer) return { ok: false }
  const followUps = (Array.isArray(v.followUps) ? v.followUps : []).filter(x => typeof x === 'string' && x.trim())
    .map(x => x.trim().slice(0, 80)).slice(0, 3)
  return { ok: true, answer, followUps }
}
