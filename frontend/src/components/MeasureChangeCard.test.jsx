// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import MeasureChangeCard from './MeasureChangeCard.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  try { localStorage.clear() } catch { /* none */ }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const e = (d, vals) => ({ d, t: Date.parse(d + 'T12:00:00Z'), other: [], ...vals })
const S = {
  unit: 'kg', body: 'male', measurements: [
    e('2026-04-01', { chest: 95 }), e('2026-07-01', { chest: 98 }),
    e('2026-09-20', { chest: 99 }), e('2026-11-01', { chest: 100 }),
  ],
}
const render = () => act(() => root.render(<MeasureChangeCard S={S} />))
const chest = () => [...host.querySelectorAll('.mchange-row')].find(r => r.textContent.startsWith('Chest')).textContent
const pick = label => act(() => [...host.querySelectorAll('.seg button')].find(b => b.textContent === label).click())

describe('MeasureChangeCard range', () => {
  it('starts on 1 month, and 3 and 6 months compare further back', () => {
    render()
    expect(host.querySelector('.seg button.on').textContent).toBe('1M')
    expect(chest()).toContain('+1')
    pick('3M')
    expect(chest()).toContain('+2')
    pick('6M')
    expect(chest()).toContain('+5')
  })

  it('remembers the choice on this device', () => {
    render()
    pick('6M')
    act(() => root.unmount())
    root = createRoot(host)
    render()
    expect(host.querySelector('.seg button.on').textContent).toBe('6M')
  })
})
