// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useStore } from '../store/useStore.js'
import { runAiReview } from './ai-review-run.js'

const answer = { summary: 'A steady month.', highlights: ['Four weeks in a row'], suggestions: [{ title: 'Add a chest day', why: 'Chest has not moved.' }] }
const deps = over => ({
  ready: () => true, consent: async () => true,
  loadDevice: async () => ({ provider: 'anthropic', model: 'claude-test', mode: 'byok' }),
  saveDevice: vi.fn(async () => {}), getKey: async () => 'sk-ant-test',
  local: { ADAPTERS: { anthropic: { invoke: vi.fn(async () => ({ code: 0, text: JSON.stringify(answer) })) } }, timeoutFor: () => 1000, guardedFetch: vi.fn() },
  ...over,
})

beforeEach(() => useStore.setState(s => ({ S: { ...s.S, aiReviews: {}, workouts: [], runs: [], measurements: [] } })))

describe('runAiReview', () => {
  it('asks the configured provider with the key and the review schema, and saves the answer', async () => {
    const d = deps()
    const entry = await runAiReview('month', { deps: d })
    const call = d.local.ADAPTERS.anthropic.invoke.mock.calls[0][0]
    expect(call.model).toBe('claude-test')
    expect(call.env).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-test' })
    expect(call.system).toMatch(/last month of training/)
    expect(call.schema.required).toEqual(['summary', 'highlights', 'suggestions'])
    expect(entry.review.suggestions[0].title).toBe('Add a chest day')
    expect(useStore.getState().S.aiReviews.month.review.summary).toBe('A steady month.')
    expect(d.saveDevice).toHaveBeenCalledWith({ daily: expect.objectContaining({ n: 1 }) })
  })

  it('says how to set it up when the Coach has no key on this phone', async () => {
    await expect(runAiReview('month', { deps: deps({ ready: () => false }) })).rejects.toMatchObject({ code: 'off' })
  })

  it('stops at the daily cap', async () => {
    const today = new Date(); const iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
    const d = deps({ loadDevice: async () => ({ provider: 'anthropic', limits: { daily: 2 }, daily: { d: iso, n: 2 } }) })
    await expect(runAiReview('month', { deps: d })).rejects.toMatchObject({ code: 'cap' })
    expect(d.local.ADAPTERS.anthropic.invoke).not.toHaveBeenCalled()
  })

  it('keeps nothing when the answer is unusable or the provider fails', async () => {
    const bad = deps({ local: { ...deps().local, ADAPTERS: { anthropic: { invoke: async () => ({ code: 0, text: '{"summary":"x","suggestions":[]}' }) } } } })
    await expect(runAiReview('stall', { deps: bad })).rejects.toThrow(/did not answer/)
    const down = deps({ local: { ...deps().local, ADAPTERS: { anthropic: { invoke: async () => ({ code: 1, stderr: '401 invalid x-api-key' }) } } } })
    await expect(runAiReview('stall', { deps: down })).rejects.toThrow(/401/)
    expect(useStore.getState().S.aiReviews.stall).toBeUndefined()
  })
})
