import { describe, it, expect } from 'vitest'
import { measurementChanges, regionColours, sideOfPath, REGIONS, BETTER } from './measure-change.js'
import { MEASUREMENT_FIELDS } from './measurements.js'

const entry = (d, vals) => ({ d, t: new Date(d + 'T12:00:00').getTime(), other: [], ...vals })
const st = (measurements, unit = 'kg') => ({ unit, measurements })
const row = (res, key) => res.rows.find(r => r.key === key)

describe('measurementChanges', () => {
  it('bigger arms and a smaller waist are both better', () => {
    const res = measurementChanges(st([
      entry('2026-09-01', { upperArmLeft: 38, waist: 90 }),
      entry('2026-10-01', { upperArmLeft: 39, waist: 88 }),
    ]))
    expect(row(res, 'upperArmLeft')).toMatchObject({ delta: 1, verdict: 'better' })
    expect(row(res, 'waist')).toMatchObject({ delta: -2, verdict: 'better' })
  })

  it('a bigger waist and smaller chest are worse', () => {
    const res = measurementChanges(st([
      entry('2026-09-01', { chest: 100, waist: 85 }),
      entry('2026-10-01', { chest: 98, waist: 87 }),
    ]))
    expect(row(res, 'chest').verdict).toBe('worse')
    expect(row(res, 'waist').verdict).toBe('worse')
  })

  it('compares against the newest reading at least the window before the latest', () => {
    const res = measurementChanges(st([
      entry('2026-07-01', { chest: 90 }),
      entry('2026-08-25', { chest: 95 }),
      entry('2026-09-20', { chest: 97 }),
      entry('2026-10-01', { chest: 100 }),
    ]), 30)
    expect(row(res, 'chest')).toMatchObject({ from: 95, to: 100, since: '2026-08-25' })
    expect(res.since).toBe('2026-08-25')
    expect(res.to).toBe('2026-10-01')
  })

  it('falls back to the first reading when everything is inside the window', () => {
    const res = measurementChanges(st([
      entry('2026-09-20', { chest: 97 }),
      entry('2026-10-01', { chest: 99 }),
    ]), 30)
    expect(row(res, 'chest')).toMatchObject({ from: 97, since: '2026-09-20' })
  })

  it('needs two readings on different days', () => {
    expect(measurementChanges(st([entry('2026-10-01', { chest: 99 })])).rows).toEqual([])
    expect(measurementChanges(st([])).rows).toEqual([])
    expect(measurementChanges({}).rows).toEqual([])
  })

  it('treats tape noise as no change', () => {
    const res = measurementChanges(st([
      entry('2026-09-01', { chest: 100 }),
      entry('2026-10-01', { chest: 100.2 }),
    ]))
    expect(row(res, 'chest').verdict).toBe('same')
  })

  it('never calls wrists or ankles better or worse', () => {
    const res = measurementChanges(st([
      entry('2026-09-01', { wristLeft: 17 }),
      entry('2026-10-01', { wristLeft: 18 }),
    ]))
    expect(row(res, 'wristLeft').verdict).toBe('neutral')
  })

  it('shows the change in inches for an lb profile', () => {
    const res = measurementChanges(st([
      entry('2026-09-01', { waist: 90 }),
      entry('2026-10-01', { waist: 87.46 }),
    ], 'lb'))
    expect(row(res, 'waist')).toMatchObject({ unit: 'in', display: -1 })
  })

  it('grades the size of a change', () => {
    const res = measurementChanges(st([
      entry('2026-09-01', { chest: 100, waist: 100, upperArmLeft: 40 }),
      entry('2026-10-01', { chest: 101, waist: 97, upperArmLeft: 42 }),
    ]))
    expect(row(res, 'chest').level).toBe(1)
    expect(row(res, 'waist').level).toBe(2)
    expect(row(res, 'upperArmLeft').level).toBe(3)
  })
})

describe('regionColours', () => {
  it('colours a side only for one-sided fields, and abdomen wins the abs over the waist', () => {
    const rows = [
      { key: 'upperArmLeft', verdict: 'better', level: 2 },
      { key: 'waist', verdict: 'worse', level: 1 },
      { key: 'abdomen', verdict: 'better', level: 3 },
    ]
    const c = regionColours(rows)
    expect(c.biceps).toEqual({ left: { verdict: 'better', level: 2 } })
    expect(c.obliques).toEqual({ left: { verdict: 'worse', level: 1 }, right: { verdict: 'worse', level: 1 } })
    expect(c.abs.left).toEqual({ verdict: 'better', level: 3 })
  })

  it('leaves unchanged fields uncoloured', () => {
    expect(regionColours([{ key: 'chest', verdict: 'same', level: 1 }]).chest).toEqual({ left: null, right: null })
  })
})

describe('sideOfPath', () => {
  it('mirrors the front view and not the back', () => {
    expect(sideOfPath('M100 400c1 1 1 1', '0 95 727 1280', 'front')).toBe('right')
    expect(sideOfPath('M600 400c1 1 1 1', '0 95 727 1280', 'front')).toBe('left')
    expect(sideOfPath('M800 400c1 1 1 1', '718 95 727 1280', 'back')).toBe('left')
    expect(sideOfPath('M1300 400c1 1 1 1', '718 95 727 1280', 'back')).toBe('right')
  })
})

describe('the tables', () => {
  it('every built-in field has a direction, and every region is a real field', () => {
    for (const f of MEASUREMENT_FIELDS) expect(BETTER[f.key]).toBeDefined()
    for (const key of Object.keys(REGIONS)) expect(MEASUREMENT_FIELDS.some(f => f.key === key)).toBe(true)
  })

  it('every region names parts the body map draws', async () => {
    const paths = (await import('./body-paths.js')).default
    const drawn = new Set(Object.values(paths).flatMap(b => Object.values(b).flatMap(v => Object.keys(v.p))))
    for (const { parts } of Object.values(REGIONS)) for (const p of parts) expect(drawn.has(p)).toBe(true)
  })
})
