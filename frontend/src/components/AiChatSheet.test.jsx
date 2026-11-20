// @vitest-environment happy-dom
// Ask GymTrackAI: a starter question becomes a turn, the answer shows with its follow-ups, the
// screen goes along with every question, and a failure puts the question back to try again.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ ready: true, chat: null }))
vi.mock('../store/useUI.js', async () => {
  const { create } = await import('zustand')
  const useUI = create((set, get) => ({
    sheets: [],
    openSheet(render) { set({ sheets: [{ id: 's', render }] }); return { id: 's', close: () => get().closeSheet() } },
    closeSheet() { set({ sheets: [] }) },
  }))
  return { useUI }
})
vi.mock('../lib/ai-review-run.js', () => ({ aiReviewReady: () => mocks.ready, runAiChat: (...a) => mocks.chat(...a) }))

const { useUI } = await import('../store/useUI.js')
const { aiChatSheet } = await import('./AiChatSheet.jsx')

function Sheets() {
  const sheets = useUI(s => s.sheets)
  return <>{sheets.map(s => <div key={s.id} className="sheet">{s.render(() => useUI.getState().closeSheet())}</div>)}</>
}

let host, root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); mocks.ready = true })
afterEach(() => { act(() => root.unmount()); host.remove(); useUI.setState({ sheets: [] }) })
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const chip = text => [...host.querySelectorAll('.ai-chip')].find(b => b.textContent === text)

describe('Ask GymTrackAI', () => {
  it('asks a starter for the screen and shows the answer with its follow-ups', async () => {
    mocks.chat = vi.fn(async () => ({ answer: 'Salmon and rice.\n- About 700 kcal\n- 45 g protein', followUps: ['Something quicker?'] }))
    act(() => root.render(<Sheets />))
    act(() => { aiChatSheet({ screen: 'nutrition', iso: '2026-11-18' }) })
    expect(host.textContent).toContain('About today’s food')
    await act(async () => chip('What should I have for dinner?').click())
    await flush()
    expect(mocks.chat).toHaveBeenCalledWith({ screen: 'nutrition', iso: '2026-11-18' }, [], 'What should I have for dinner?')
    expect([...host.querySelectorAll('.ai-msg.you')].map(x => x.textContent)).toEqual(['What should I have for dinner?'])
    expect([...host.querySelectorAll('.ai-msg.ai li')].map(x => x.textContent)).toEqual(['About 700 kcal', '45 g protein'])
    expect(chip('Something quicker?')).toBeTruthy()
    await act(async () => chip('Something quicker?').click())
    await flush()
    expect(mocks.chat.mock.calls[1][1].map(x => x.role)).toEqual(['you', 'ai'])
  })

  it('puts the question back when GymTrackAI does not answer', async () => {
    mocks.chat = vi.fn(async () => { throw new Error('GymTrackAI did not answer. Try again in a moment.') })
    act(() => root.render(<Sheets />))
    act(() => { aiChatSheet({ screen: 'exercise', exId: '0025' }) })
    expect(host.textContent).toContain('About barbell bench press')
    await act(async () => chip('Where should I feel it?').click())
    await flush()
    expect(host.querySelector('.ai-err').textContent).toMatch(/did not answer/)
    expect(host.querySelector('textarea').value).toBe('Where should I feel it?')
    expect(host.querySelectorAll('.ai-msg.you')).toHaveLength(0)
  })

  it('offers the setup when the Coach has no key on this phone', () => {
    mocks.ready = false
    act(() => root.render(<Sheets />))
    act(() => { aiChatSheet() })
    expect(host.textContent).toContain('Set up GymTrackAI')
    expect(host.querySelector('textarea')).toBeNull()
  })
})
