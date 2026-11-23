import { describe, it, expect } from 'vitest'
import { planForModel, libraryForModel, checkProposal, applyProposal, undoProposal, exerciseByName, exerciseLine } from './ai-plan.js'

const TODAY = '2026-11-23'   // a Monday
const base = () => ({
  unit: 'kg', customEx: [], dayPlan: {}, week: { 1: 'r1' },
  routines: [{ id: 'r1', name: 'Push & Back', emoji: 'barbell', ex: [{ id: '0025', sets: 3, reps: 12, repsMin: 10, weight: 37, mode: 'reps' }] }],
  workouts: [{ d: '2026-11-20', entries: [{ id: '0047' }] }],
})

describe('what GymTrackAI is told about the plan', () => {
  it('routines with their exercises, the week by name, and the exercises it may use', () => {
    const p = planForModel(base(), TODAY)
    expect(p.routines[0]).toMatchObject({ id: 'r1', name: 'Push & Back' })
    expect(p.routines[0].exercises[0]).toMatchObject({ id: '0025', sets: 3, reps: '10-12', weight: '37 kg' })
    expect(p.week).toEqual({ Mon: ['Push & Back'] })
    expect(libraryForModel(base()).map(e => e.id)).toEqual(['0047', '0025'])
  })
})

describe('checkProposal', () => {
  it('keeps real exercises with sensible numbers, and finds one by name', () => {
    const r = checkProposal(base(), { kind: 'newRoutine', name: ' Push & Back (neck-friendly) ', on: { date: 'today' }, exercises: [
      { id: '0025', sets: 3, reps: 12, repsMin: 10, weight: 37 },
      { name: 'barbell bench press', sets: 2, reps: 12 },          // the same lift again: once
      { id: 'nope', name: 'zzzz qqqq', sets: 3, reps: 10 },
      { id: '0047', sets: 40, reps: 0, weight: 9999 },
    ] }, TODAY)
    expect(r.ok).toBe(true)
    expect(r.dropped).toEqual(['zzzz qqqq'])
    expect(r.proposal).toMatchObject({ kind: 'newRoutine', name: 'Push & Back (neck-friendly)', on: { date: TODAY } })
    expect(r.proposal.exercises).toEqual([{ id: '0025', sets: 3, reps: 12, repsMin: 10, weight: 37 }, { id: '0047', sets: 10, reps: 1 }])
    expect(exerciseByName(base(), 'barbell bench press').id).toBe('0025')
  })
  it('refuses an edit or schedule of a routine that is not there, and a day out of reach', () => {
    expect(checkProposal(base(), { kind: 'schedule', routineId: 'gone', on: { date: TODAY } }, TODAY).ok).toBe(false)
    expect(checkProposal(base(), { kind: 'schedule', routineId: 'r1', on: { date: '2026-11-01' } }, TODAY).ok).toBe(false)
    expect(checkProposal(base(), { kind: 'schedule', routineId: 'r1', on: { weekdays: ['Wed', 'Funday'] } }, TODAY).proposal.on).toEqual({ weekdays: ['Wed'] })
    expect(checkProposal(base(), { kind: 'newRoutine', exercises: [] }, TODAY).ok).toBe(false)
    expect(checkProposal(base(), null).ok).toBe(false)
  })
})

describe('applying and undoing', () => {
  it('saves a new routine on today only, and Undo takes it all back', () => {
    const S = base()
    const { proposal } = checkProposal(S, { kind: 'newRoutine', name: 'Quick upper', on: { date: TODAY }, exercises: [{ id: '0025', sets: 3, reps: 10, weight: 37 }] }, TODAY)
    const undo = applyProposal(S, proposal)
    const made = S.routines.find(r => r.name === 'Quick upper')
    expect(made.ex[0]).toMatchObject({ id: '0025', sets: 3, reps: 10, weight: 37, mode: 'reps' })
    expect(S.dayPlan[TODAY]).toBe(made.id)
    expect(S.week[1]).toBe('r1')                                    // the usual Monday is untouched
    undoProposal(S, undo)
    expect(S.routines.map(r => r.id)).toEqual(['r1'])
    expect(S.dayPlan[TODAY]).toBeUndefined()
  })
  it('edits a routine and moves it to other weekdays, and Undo restores both', () => {
    const S = base()
    const { proposal } = checkProposal(S, { kind: 'editRoutine', routineId: 'r1', on: { weekdays: ['Thu'] }, exercises: [{ id: '0047', sets: 4, reps: 8 }] }, TODAY)
    const undo = applyProposal(S, proposal)
    expect(S.routines[0].ex.map(c => c.id)).toEqual(['0047'])
    expect(S.week[4]).toBe('r1')
    undoProposal(S, undo)
    expect(S.routines[0].ex[0]).toMatchObject({ id: '0025', weight: 37 })
    expect(S.week[4]).toBeUndefined()
  })
  it('describes an exercise for the card', () => {
    expect(exerciseLine({ id: '0025', sets: 3, reps: 12, repsMin: 10, weight: 37 })).toMatch(/^Barbell Bench Press · 3 × 10–12 · 37 kg$/i)
  })
})
