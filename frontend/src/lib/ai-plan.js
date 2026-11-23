// GymTrackAI changing your plan from a chat: what it is told about the plan, the one proposal an
// answer may carry, the check that turns the model's proposal into something safe to save, and
// applying it (with what Undo needs). Pure: state in, state out.
//
// A proposal is one of:
//   newRoutine    { kind, name, exercises, on? }   a routine to save, maybe put on a day
//   editRoutine   { kind, routineId, name?, exercises, on? }   an existing routine's exercises replaced
//   schedule      { kind, routineId, on }          an existing routine put on a day or weekdays
// `exercises`: [{ id, sets, reps, repsMin?, weight? }], ids from the catalogue (lib/exercises.js).
// `on`: { date: 'YYYY-MM-DD' } for that day only (S.dayPlan, as the Home week's "change this
// day" does) or { weekdays: ['Mon', ...] } for every week (S.week, as Plan's days do).
//
// Nothing is written until you tap Save on the card (components/AiProposalCard.jsx).
import { EXIDX, searchScore, allExercises } from './exercises.js'
import { pickedExerciseConfig } from './history.js'
import { exerciseNameText, isoOf, uid } from './format.js'

export const PROPOSAL_KINDS = ['newRoutine', 'editRoutine', 'schedule']
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_EX = 15
const LIBRARY_MAX = 150
const DAY = 86400e3

const nameOf = id => { const ex = EXIDX[id]; return ex ? exerciseNameText(ex) : id }
const clampInt = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null }

/** The plan as the model reads it: routines with their exercises, the week, and what is on today. */
export function planForModel(S, today = isoOf(new Date())) {
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const routines = (S?.routines || []).filter(r => r && r.id).map(r => ({
    id: r.id, name: r.name,
    exercises: (r.ex || []).filter(c => c && c.id).map(c => ({
      id: c.id, name: nameOf(c.id), sets: c.sets ?? null,
      reps: c.repsMin ? `${c.repsMin}-${c.reps}` : c.reps ?? null,
      ...(Number(c.weight) > 0 ? { weight: `${c.weight} ${unit}` } : {}),
    })),
  }))
  const byId = new Map(routines.map(r => [r.id, r.name]))
  const week = {}
  for (let wd = 0; wd < 7; wd++) {
    const names = [].concat(S?.week?.[wd] || []).map(id => byId.get(id)).filter(Boolean)
    if (names.length) week[WD[wd]] = names
  }
  const override = S?.dayPlan?.[today]
  return { routines, week, ...(override === 'rest' ? { todayOverride: 'rest' } : byId.has(override) ? { todayOverride: byId.get(override) } : {}) }
}

/** Exercises the model may use by id: everything in your routines and history, most recent first. */
export function libraryForModel(S) {
  const seen = new Set(), out = []
  const add = id => { if (id && !seen.has(id) && (EXIDX[id] || (S?.customEx || []).some(c => c?.id === id))) { seen.add(id); out.push({ id, name: nameOf(id) }) } }
  for (const w of [...(S?.workouts || [])].reverse()) for (const e of w?.entries || []) add(e?.id)
  for (const r of S?.routines || []) for (const c of r?.ex || []) add(c?.id)
  return out.slice(0, LIBRARY_MAX)
}

/** An exercise for a name the model gave instead of an id: the catalogue's best match, or null. */
export function exerciseByName(S, name) {
  const q = String(name || '').trim()
  if (q.length < 3) return null
  const plain = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const want = plain(q)
  const all = allExercises(S || {})
  // The name exactly, first: "barbell bench press" is not "barbell banded bench press".
  const exact = all.find(ex => plain(ex.n || ex.name) === want)
  if (exact) return exact
  let top = 0, best = []
  for (const ex of all) {
    const s = searchScore(ex, q)
    if (s > top) { top = s; best = [ex] } else if (s === top && s > 0) best.push(ex)
  }
  if (top < 100) return null
  // Of the equally good, the plainest: the shortest name.
  return best.sort((a, b) => String(a.n || a.name).length - String(b.n || b.name).length)[0]
}

function cleanOn(on, today) {
  if (!on || typeof on !== 'object') return null
  if (typeof on.date === 'string') {
    const d = on.date === 'today' ? today : on.date
    const t0 = new Date(today + 'T12:00:00').getTime(), t = new Date(d + 'T12:00:00').getTime()
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && t >= t0 && t <= t0 + 14 * DAY ? { date: d } : null
  }
  if (Array.isArray(on.weekdays)) {
    const days = [...new Set(on.weekdays.filter(w => WD.includes(w)))]
    return days.length ? { weekdays: days } : null
  }
  return null
}

/**
 * The model's proposal, checked against the state: { ok, proposal } with real exercise ids,
 * sensible sets, reps and weights, a routine that exists for an edit or a schedule, and a day
 * from today to two weeks ahead. { ok: false } for anything else; `dropped` names exercises that
 * could not be matched.
 */
export function checkProposal(S, p, today = isoOf(new Date())) {
  if (!p || typeof p !== 'object' || !PROPOSAL_KINDS.includes(p.kind)) return { ok: false }
  const on = cleanOn(p.on, today)
  const routine = p.routineId ? (S?.routines || []).find(r => r?.id === p.routineId) : null
  if (p.kind === 'schedule') return routine && on ? { ok: true, proposal: { kind: 'schedule', routineId: routine.id, on } } : { ok: false }
  if (p.kind === 'editRoutine' && !routine) return { ok: false }
  const dropped = [], exercises = []
  for (const e of Array.isArray(p.exercises) ? p.exercises : []) {
    if (exercises.length >= MAX_EX) break
    const ex = (e?.id && (EXIDX[e.id] || (S?.customEx || []).find(c => c?.id === e.id))) || exerciseByName(S, e?.name)
    if (!ex) { if (e?.name || e?.id) dropped.push(String(e.name || e.id).slice(0, 60)); continue }
    if (exercises.some(x => x.id === ex.id)) continue
    const reps = clampInt(e.reps, 1, 50) ?? 10
    const repsMin = clampInt(e.repsMin, 1, 50)
    const weight = Number(e.weight)
    exercises.push({ id: ex.id, sets: clampInt(e.sets, 1, 10) ?? 3, reps, ...(repsMin && repsMin < reps ? { repsMin } : {}),
      ...(weight > 0 && weight <= 500 ? { weight: Math.round(weight * 4) / 4 } : {}) })
  }
  if (!exercises.length) return { ok: false, dropped }
  const name = String(p.name || routine?.name || '').trim().slice(0, 60) || 'GymTrackAI workout'
  return { ok: true, dropped, proposal: { kind: p.kind, ...(routine ? { routineId: routine.id } : {}), name, exercises, ...(on ? { on } : {}) } }
}

const cfgOf = e => {
  const base = pickedExerciseConfig(e.id)
  return { ...base, id: e.id, sets: e.sets, ...(base.mode === 'time' ? {} : { reps: e.reps, ...(e.repsMin ? { repsMin: e.repsMin } : {}) }), weight: e.weight ?? base.weight ?? 0 }
}

/**
 * Saves a checked proposal into S (a store draft). Returns what Undo needs: { routineId, made,
 * ex, name, dayPlan, week } with the values from before.
 */
export function applyProposal(S, p) {
  const undo = { kind: p.kind }
  let id = p.routineId
  if (p.kind === 'newRoutine') {
    id = uid()
    if (!Array.isArray(S.routines)) S.routines = []
    S.routines.push({ id, name: p.name, emoji: 'dumbbell', ex: p.exercises.map(cfgOf) })
    undo.made = id
  } else if (p.kind === 'editRoutine') {
    const r = S.routines.find(x => x.id === id)
    undo.routineId = id; undo.ex = structuredClone(r.ex); undo.name = r.name
    r.ex = p.exercises.map(cfgOf)
    if (p.name) r.name = p.name
  }
  if (p.on?.date) {
    if (!S.dayPlan || typeof S.dayPlan !== 'object') S.dayPlan = {}
    undo.dayPlan = { [p.on.date]: S.dayPlan[p.on.date] ?? null }
    S.dayPlan[p.on.date] = id
  } else if (p.on?.weekdays) {
    if (!S.week || typeof S.week !== 'object') S.week = {}
    undo.week = {}
    for (const w of p.on.weekdays) {
      const wd = WD.indexOf(w)
      undo.week[wd] = S.week[wd] ?? null
      S.week[wd] = id
    }
  }
  undo.routineId = id
  return undo
}

/** Puts back what applyProposal changed. */
export function undoProposal(S, undo) {
  if (!undo) return
  for (const [d, v] of Object.entries(undo.dayPlan || {})) { if (v == null) delete S.dayPlan[d]; else S.dayPlan[d] = v }
  for (const [wd, v] of Object.entries(undo.week || {})) { if (v == null) delete S.week[wd]; else S.week[wd] = v }
  if (undo.made) S.routines = (S.routines || []).filter(r => r.id !== undo.made)
  else if (undo.ex) { const r = (S.routines || []).find(x => x.id === undo.routineId); if (r) { r.ex = undo.ex; r.name = undo.name } }
}

/** What the card shows for one exercise: "Dumbbell Bench Press · 3 × 10–12 · 37 kg". */
export function exerciseLine(e, unit = 'kg') {
  return [nameOf(e.id), `${e.sets} × ${e.repsMin ? e.repsMin + '–' : ''}${e.reps}`, e.weight ? `${e.weight} ${unit}` : null].filter(Boolean).join(' · ')
}
