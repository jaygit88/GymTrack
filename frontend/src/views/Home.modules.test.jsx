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

describe('measurement goals on Home', () => {
  const m = (d, v) => ({ d, t: Date.parse(d + 'T12:00:00Z'), other: [], ...v })
  it('flags a goal that has not improved in a month', () => {
    mountWith(undefined, { measurements: [m('2026-09-01', { chest: 100, waist: 90 }), m('2026-10-05', { chest: 100, waist: 88 })] })
    const card = host.querySelector('.mstall-card')
    expect(card).toBeTruthy()
    expect(card.textContent).toContain('No progress in a month')
    expect(card.textContent).toContain('Chest')
    expect(card.textContent).not.toContain('Waist')
  })
  it('stays away when every goal improved, or with body off', () => {
    mountWith(undefined, { measurements: [m('2026-09-01', { chest: 100 }), m('2026-10-05', { chest: 102 })] })
    expect(host.querySelector('.mstall-card')).toBeNull()
    mountWith({ body: false }, { measurements: [m('2026-09-01', { chest: 100 }), m('2026-10-05', { chest: 100 })] })
    expect(host.querySelector('.mstall-card')).toBeNull()
  })
})

describe('runs from Health Connect in the last seven days', () => {
  it('a run and a lift on one day are two rows, in the order they happened', () => {
    const start = new Date(today + 'T06:30:00').getTime()
    mountWith(undefined, { runs: [{ id: 'hc:1', d: today, start, end: start + 30 * 60e3, km: 5, title: null, type: 'running', src: 'hc' }],
      workouts: [{ id: 'w1', d: today, start: start + 10 * 3600e3, end: start + 11 * 3600e3, entries: [] }] })
    const rows = [...host.querySelectorAll('.recent-day')]
    expect(rows[0].classList.contains('recent-run')).toBe(true)
    expect(rows[0].textContent).toContain('Run')
    expect(rows[0].textContent).toContain('5 km')
    expect(rows[0].textContent).toContain('6:00 /km')
    expect(rows[1].classList.contains('recent-run')).toBe(false)
    expect(rows[2].classList.contains('rest')).toBe(true)
  })
})
