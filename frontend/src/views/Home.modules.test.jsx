// @vitest-environment happy-dom
// Settings → Modules on Home: a module switched off takes its cards with it, and brings them
// back when it is on again. Visibility only; what the cards do is their own tests'.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { presetModules } from '../lib/modules.js'
import Home from './Home.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), calendarSheet: vi.fn(), workoutDetailSheet: vi.fn(), logPastWorkoutSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const today = new Date().toISOString().slice(0, 10)
const mountWith = (modules, extra = {}) => {
  useStore.setState(s => ({
    S: { ...s.S, routines: [{ id: 'r1', name: 'Push', ex: [] }], workouts: [{ id: 'w1', d: today, start: Date.now() - 4e6, end: Date.now() - 3e6, entries: [] }],
      bodyweight: [{ d: today, w: 80, t: Date.now() }], dayPlan: {}, week: {}, active: null, modules, homeMuscleSets: false, ...extra },
    user: null,
  }))
  act(() => root.render(<Home />))
}
const heads = () => [...host.querySelectorAll('.card-head-title')].map(el => el.textContent)

describe('Home follows the modules', () => {
  it('Everything: the streak with the last seven days, and the body change map', () => {
    mountWith(undefined)
    expect(heads().some(h => /week streak/.test(h))).toBe(true)
    expect(heads()).toContain('Body measurements')
    expect(host.querySelectorAll('.recent-days .recent-day').length).toBeGreaterThanOrEqual(7)
    // GymTrack: no planned week, no check-in and no body weight card on Home
    expect(host.querySelector('.week')).toBeNull()
    expect(heads()).not.toContain('Check in')
    expect(heads()).not.toContain('Body weight')
  })

  it('Just training: no streak or body card, and the last seven days keep a card of their own', () => {
    mountWith(presetModules('training'))
    expect(heads().some(h => /week streak/.test(h))).toBe(false)
    expect(heads()).not.toContain('Body measurements')
    expect(heads()).toContain('Last 7 days')
    expect(host.querySelector('[data-tour="today"]')).toBeTruthy()
  })

  it('body off hides the body change map, and back on brings it back', () => {
    mountWith({ body: false })
    expect(heads()).not.toContain('Body measurements')
    mountWith({ body: true })
    expect(heads()).toContain('Body measurements')
  })

  it("today's workout is on today's row, and a day without one is a rest day", () => {
    mountWith(undefined)
    const rows = [...host.querySelectorAll('.recent-day')]
    expect(rows[0].getAttribute('data-tour')).toBe('today')
    expect(rows[0].classList.contains('rest')).toBe(false)
    expect(rows[1].classList.contains('rest')).toBe(true)
  })
})
