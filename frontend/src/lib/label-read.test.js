import { describe, it, expect } from 'vitest'
import { checkLabel, buildLabelPrompt, LABEL_SCHEMA } from './label-read.js'

const n = o => ({ kcal: null, protein: null, carbs: null, sugars: null, fat: null, satfat: null, fibre: null, salt: null, ...o })

describe('checkLabel', () => {
  it('takes the per 100 g column, rounded', () => {
    expect(checkLabel({ readable: true, name: ' Greek style yogurt, Tesco ', per100g: n({ kcal: 132.6, protein: 5.04, carbs: 4.2, sugars: 4.2, fat: 10.2, satfat: 6.6, salt: 0.15 }), perServing: null, servingG: 150, problem: '' }))
      .toEqual({ ok: true, name: 'Greek style yogurt, Tesco', per100: { kcal: 133, protein: 5, carbs: 4.2, fat: 10.2, sugars: 4.2, fibre: null, satfat: 6.6, salt: 0.2 }, serving: { g: 150 } })
  })
  it('turns a per-serving-only label into per 100 g', () => {
    const r = checkLabel({ readable: true, name: 'Protein bar', per100g: null, perServing: n({ kcal: 210, protein: 20, carbs: 18, fat: 7 }), servingG: 60, problem: '' })
    expect(r.ok).toBe(true)
    expect(r.per100).toMatchObject({ kcal: 350, protein: 33.3, carbs: 30, fat: 11.7 })
  })
  it('refuses an unreadable photo, a label without calories, and numbers no food can have', () => {
    expect(checkLabel({ readable: false, problem: 'No nutrition table in the photo' })).toEqual({ ok: false, problem: 'No nutrition table in the photo' })
    expect(checkLabel({ readable: true, per100g: n({ protein: 10 }), perServing: null, servingG: null }).ok).toBe(false)
    expect(checkLabel({ readable: true, per100g: null, perServing: n({ kcal: 200 }), servingG: null }).ok).toBe(false)
    expect(checkLabel({ readable: true, per100g: n({ kcal: 1800, protein: 10 }) }).ok).toBe(false)
    expect(checkLabel({ readable: true, per100g: n({ kcal: 400, protein: 60, carbs: 60 }) }).ok).toBe(false)
    expect(checkLabel(null).ok).toBe(false)
  })
})

describe('buildLabelPrompt', () => {
  it('asks for the printed numbers only, and passes the name you typed', () => {
    const p = buildLabelPrompt({ name: 'Oat bar', langName: 'English' })
    expect(p.system).toMatch(/never estimate/)
    expect(p.user).toContain('"Oat bar"')
    expect(LABEL_SCHEMA.required).toContain('per100g')
  })
})
