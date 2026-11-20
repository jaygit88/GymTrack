import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONSENT_VERSION } from '../lib/coach.js'   // the consent a fixture grants is the current one, whatever its number
import { effectiveRoutine } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
const { default: CoachChat } = await import('./CoachChat.jsx')

// The chat is where a plan is imported. These pin that the Import button applies the pending
// plan through the store, writes the decision into the thread, and leaves today startable.
const mocks = vi.hoisted(() => {
  const state = { runAiChat: null, S: null, pending: null, job: null, community: false, maxMessageLen: 2200, nav: vi.fn(), toast: vi.fn(), openSheet: vi.fn(), refresh: vi.fn() }
  state.storeSnapshot = () => ({
    S: state.S,
    user: { id: 'u1' },
    ready: true,
    config: { coach: { enabled: true, ...(state.community ? { community: true } : {}) } },
    coachLocal: null,
    update: mut => mut(state.S),
  })
  state.uiSnapshot = () => ({ toast: state.toast, openSheet: state.openSheet })
  return state
})

vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.storeSnapshot())
  useStore.getState = mocks.storeSnapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = selector => selector ? selector(mocks.uiSnapshot()) : mocks.uiSnapshot()
  useUI.getState = mocks.uiSnapshot
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../lib/coach-api.js', () => ({
  useCoachStatus: () => ({ pending: mocks.pending, job: mocks.job, cap: null, loading: false, lastError: null, last: null, refresh: mocks.refresh, maxMessageLen: mocks.maxMessageLen }),
  resolvePending: vi.fn(() => Promise.resolve({})),
  refinePlan: vi.fn(() => Promise.resolve({})),
  requestReview: vi.fn(() => Promise.resolve({})),
  requestDebrief: vi.fn(() => Promise.resolve({})),
  cohortStats: vi.fn(() => Promise.resolve({ ok: false, enabled: true, sharing: false })),
  setCohortShare: vi.fn(() => Promise.resolve({ ok: true, sharing: true })),
  JOB_ERRORS: { internal: 'x' },
  ensureAiConsent: vi.fn(() => Promise.resolve(true)),
  isDeclined: e => e?.code === 'declined',
  awaitedJob: () => null,
  settleAwaited: vi.fn(),
}))
vi.mock('../sheets.jsx', () => ({ startFlow: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})),
  IS_APPLE: false, IS_ANDROID: false, BIO: 'biometrics',
}))
vi.mock('../coach.css', () => ({}))
vi.mock('../lib/ai-review-run.js', () => ({ aiReviewReady: () => true, aiReviewRunning: () => null, runAiReview: vi.fn(), runLabelRead: vi.fn(),
  runAiChat: (...a) => mocks.runAiChat(...a) }))

let dom, root, container
const TODAY_WD = new Date(todayISO() + 'T12:00:00').getDay()

const bundle = week => ({
  opengym_plan: 1, name: 'Coach plan', summary: 'a plan',
  week,
  routines: [
    { id: 'x1', name: 'Full body A', emoji: '💪', why: 'first', ex: [{ id: '0001', sets: 3, reps: 10, mode: 'reps', why: 'because' }] },
    { id: 'x2', name: 'Full body B', emoji: '🏋️', ex: [{ id: '0002', sets: 3, reps: 8, mode: 'reps' }] }
  ],
  customEx: [],
})
const everyDay = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, 'x1']))

const state = () => ({
  unit: 'kg', lang: 'en', customEx: [], workouts: [], bodyweight: [], exWeights: {},
  dayPlan: {}, routines: [], week: {},
  coach: {
    consent: { agreedAt: '2026-07-01T00:00:00Z', version: CONSENT_VERSION },
    profile: { goal: 'muscle', experience: 'new', daysPerWeek: 3, sessionMin: 60, preferredDays: [1, 3, 5], equipment: [] },
    log: [], snapshots: [], chat: [{ id: 'c1', role: 'user', kind: 'intake', at: 1 }], timings: []
  },
})

function installDom() {
  const parsed = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  dom = parsed.window
  globalThis.window = dom
  globalThis.document = dom.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  for (const key of ['HTMLElement', 'Node', 'Element', 'Event', 'Blob']) globalThis[key] = dom[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.getElementById('root')
  root = createRoot(container)
}

async function mount(pending, job = null, { community = false, S = state() } = {}) {
  mocks.S = S
  mocks.pending = pending
  mocks.job = job
  mocks.community = community
  installDom()
  await act(async () => { root.render(React.createElement(CoachChat)) })
}

const byText = re => [...container.querySelectorAll('button')].find(b => re.test(b.textContent || ''))
async function click(el) {
  expect(el).toBeTruthy()
  await act(async () => { el.dispatchEvent(new dom.Event('click', { bubbles: true })) })
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(async () => {
  if (root) { await act(async () => { root.unmount() }); root = null }
  container = null; dom = null
})

describe('GymTrackAI in the chat', () => {
  it('answers a question itself, with the conversation so far, and keeps both turns', async () => {
    mocks.runAiChat = vi.fn(async () => ({ answer: 'About 130 g a day on the days you logged, short of 150.', followUps: ['What should I eat tonight?'] }))
    const S = state()
    S.routines = [{ id: 'r1', name: 'Push', ex: [] }]
    S.coach.chat.push({ id: 'c2', role: 'user', kind: 'text', text: 'Hi', at: 2 }, { id: 'c3', role: 'coach', kind: 'text', text: 'Hello', at: 3, followUps: ['How is my protein?'] })
    await mount(null, null, { S })
    expect(container.textContent).toContain('GymTrackAI')
    await click(byText(/How is my protein\?/))
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(mocks.runAiChat).toHaveBeenCalledWith({ screen: 'general' }, [{ role: 'you', text: 'Hi' }, { role: 'ai', text: 'Hello' }], 'How is my protein?')
    const tail = S.coach.chat.slice(-2)
    expect(tail.map(m => [m.role, m.text])).toEqual([['user', 'How is my protein?'], ['coach', 'About 130 g a day on the days you logged, short of 150.']])
    expect(tail[1].followUps).toEqual(['What should I eat tonight?'])
    expect(byText(/What should I eat tonight\?/)).toBeTruthy()
  })
})
