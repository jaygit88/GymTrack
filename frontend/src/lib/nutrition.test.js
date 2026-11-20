import { describe, it, expect } from 'vitest'
import {
  nutrientsFor, sum, recipeNutrients, cleanRecipe, makeEntry, addEntry, removeEntry, updateAmount,
  dayTotals, mealTotals, averages, recentFoods, suggestTargets, targetsOf, nutritionSummary, dayBudget, copyMeal, toggleFav, isFav, proteinNudge, proteinNudgeOf,
} from './nutrition.js'

const oats = { id: 'cofid:oats', src: 'cofid', name: 'Oats', per100: { kcal: 375, protein: 11, carbs: 66, fat: 8, sugars: 1, fibre: 9, satfat: 1.5, salt: 0 } }
const milk = { id: 'cofid:milk', src: 'cofid', name: 'Milk, semi-skimmed', per100: { kcal: 46, protein: 3.5, carbs: 4.7, fat: 1.7, sugars: 4.7, fibre: 0, satfat: 1.1, salt: 0.1 } }
const whey = { id: 'mine:whey', src: 'custom', name: 'Whey', per100: { kcal: 400, protein: 80, carbs: 6, fat: 6, sugars: 4, fibre: null, satfat: 3, salt: 0.5 } }

describe('nutrientsFor and sum', () => {
  it('scales per 100 g, unknown values as 0', () => {
    expect(nutrientsFor(oats.per100, 50)).toMatchObject({ kcal: 188, protein: 5.5, carbs: 33 })
    expect(nutrientsFor(whey.per100, 30).fibre).toBe(0)
    expect(sum([{ kcal: 100, protein: 10 }, { kcal: 50.4, protein: 2.25 }])).toMatchObject({ kcal: 150, protein: 12.3 })
  })
})

describe('recipes', () => {
  const smoothie = cleanRecipe({ name: ' Recovery smoothie ', servings: 2, items: [
    { name: 'Oats', src: 'cofid', ref: oats.id, grams: 40, per100: oats.per100 },
    { name: 'Milk', src: 'cofid', ref: milk.id, grams: 500, per100: milk.per100 },
    { name: 'Whey', src: 'custom', ref: whey.id, grams: 60, per100: whey.per100 },
    { name: 'nothing', grams: 0, per100: oats.per100 },
  ] })
  it('cleans the recipe and works out the batch, a serving and per 100 g', () => {
    expect(smoothie.name).toBe('Recovery smoothie')
    expect(smoothie.items).toHaveLength(3)
    const r = recipeNutrients(smoothie)
    expect(r.grams).toBe(600)
    expect(r.total.kcal).toBe(150 + 230 + 240)
    expect(r.perServing.kcal).toBe(310)
    expect(r.perServing.protein).toBeCloseTo((4.4 + 17.5 + 48) / 2, 1)
    expect(r.per100.kcal).toBeCloseTo(620 / 6, 0)
  })
  it('is logged by servings', () => {
    const e = makeEntry({ id: 'e1', meal: 'snacks', recipe: { ...smoothie, id: 'r1' }, servings: 1.5 })
    expect(e).toMatchObject({ src: 'recipe', ref: 'r1', servings: 1.5 })
    expect(e.n.kcal).toBe(465)
  })
})

describe('the diary', () => {
  const S = { foodLog: {} }
  it('adds, totals by day and meal, changes amounts and removes', () => {
    addEntry(S, '2026-11-18', makeEntry({ id: 'a', meal: 'breakfast', food: oats, grams: 60, at: 1 }))
    addEntry(S, '2026-11-18', makeEntry({ id: 'b', meal: 'breakfast', food: milk, grams: 250, at: 2 }))
    addEntry(S, '2026-11-18', makeEntry({ id: 'c', meal: 'snacks', quick: { name: 'Protein bar', kcal: 210, protein: 20 }, at: 3 }))
    expect(dayTotals(S, '2026-11-18').kcal).toBe(225 + 115 + 210)
    expect(mealTotals(S, '2026-11-18', 'breakfast').protein).toBeCloseTo(6.6 + 8.8, 1)
    updateAmount(S, '2026-11-18', 'a', 80)
    expect(S.foodLog['2026-11-18'][0]).toMatchObject({ grams: 80, n: { kcal: 300 } })
    removeEntry(S, '2026-11-18', 'c')
    expect(dayTotals(S, '2026-11-18').kcal).toBe(415)
    removeEntry(S, '2026-11-18', 'a'); removeEntry(S, '2026-11-18', 'b')
    expect(S.foodLog['2026-11-18']).toBeUndefined()
  })
  it('keeps what was eaten when the food changes later', () => {
    const e = makeEntry({ id: 'x', meal: 'lunch', food: { ...oats }, grams: 100 })
    oats.per100.kcal = 9999
    expect(e.n.kcal).toBe(375)
    oats.per100.kcal = 375
  })
})

describe('averages and recent foods', () => {
  const NOW = new Date('2026-11-18T20:00:00').getTime()
  const S = { foodLog: {
    '2026-11-18': [makeEntry({ id: 'a', meal: 'lunch', food: oats, grams: 100, at: 30 })],
    '2026-11-16': [makeEntry({ id: 'b', meal: 'lunch', food: oats, grams: 200, at: 20 }), makeEntry({ id: 'c', meal: 'snacks', food: whey, grams: 30, at: 21 })],
    '2026-10-01': [makeEntry({ id: 'd', meal: 'lunch', food: milk, grams: 100, at: 1 })],
  } }
  it('averages the logged days only', () => {
    expect(averages(S, 7, NOW)).toMatchObject({ days: 2, avg: { kcal: Math.round((375 + 750 + 120) / 2) } })
    expect(averages({}, 7, NOW)).toEqual({ days: 0, avg: null })
  })
  it('lists each food once, the latest first', () => {
    expect(recentFoods(S).map(e => e.ref)).toEqual(['cofid:oats', 'mine:whey', 'cofid:milk'])
  })
})

describe('targets', () => {
  it('suggests protein and calories for gaining from the latest weigh-in', () => {
    expect(suggestTargets({ unit: 'kg', bodyweight: [{ d: '2026-11-01', w: 85 }] })).toEqual({ kcal: 3050, protein: 155 })
    expect(suggestTargets({ unit: 'lb', bodyweight: [{ d: '2026-11-01', w: 187.4 }] }).protein).toBe(155)
    expect(suggestTargets({})).toBeNull()
  })
  it('reads the saved targets', () => {
    expect(targetsOf({ nutritionTargets: { kcal: 2900, protein: 160 } })).toEqual({ kcal: 2900, protein: 160, carbs: null, fat: null, earnBack: 0.5 })
    expect(targetsOf({})).toBeNull()
  })
})

describe('nutritionSummary', () => {
  const now = new Date('2026-11-18T12:00:00').getTime()
  it('is null without a logged day', () => {
    expect(nutritionSummary({}, { now })).toBeNull()
  })
  it('averages the logged days, with targets and what those days burned', () => {
    const S = { nutritionTargets: { kcal: 2900, protein: 160 }, foodLog: {
      '2026-11-18': [{ id: 'a', meal: 'lunch', n: { kcal: 2000, protein: 120, carbs: 200, fat: 60 } }],
      '2026-11-16': [{ id: 'b', meal: 'lunch', n: { kcal: 3000, protein: 160, carbs: 300, fat: 100 } }],
    } }
    const burned = { '2026-11-18': 400, '2026-11-17': 900 }
    expect(nutritionSummary(S, { days: 7, now, burnedOn: iso => burned[iso] || 0 })).toEqual({
      daysLogged: 2, ofDays: 7,
      averageDay: { kcal: 2500, proteinG: 140, carbsG: 250, fatG: 80 },
      targets: { kcal: 2900, proteinG: 160 },
      averageBurnedInWorkoutsKcal: 200,
    })
  })
})

describe('dayBudget', () => {
  const S = over => ({ nutritionTargets: { kcal: 2900, protein: 150 }, exerciseLog: { '2026-11-18': [{ id: 'a', name: 'Padel', kcal: 437 }] }, ...over })
  it('adds back half of the day\'s exercise by default, rounded to 10', () => {
    expect(dayBudget(S(), '2026-11-18')).toEqual({ base: 2900, burned: 437, earned: 220, total: 3120 })
    expect(dayBudget(S(), '2026-11-17')).toEqual({ base: 2900, burned: 0, earned: 0, total: 2900 })
  })
  it('follows the share you chose, and needs a calorie target', () => {
    expect(dayBudget(S({ nutritionTargets: { kcal: 2900, earnBack: 0 } }), '2026-11-18').total).toBe(2900)
    expect(dayBudget(S({ nutritionTargets: { kcal: 2900, earnBack: 1 } }), '2026-11-18').earned).toBe(440)
    expect(dayBudget(S({ nutritionTargets: { kcal: 2900, earnBack: 0.4 } }), '2026-11-18').earned).toBe(220)
    expect(dayBudget({}, '2026-11-18')).toBeNull()
  })
})

describe('faster logging', () => {
  it('copies a meal onto another day with new ids', () => {
    const S = { foodLog: { '2026-11-17': [{ id: 'a', meal: 'breakfast', name: 'Porridge', n: { kcal: 400, protein: 15 } }, { id: 'b', meal: 'lunch', name: 'Wrap', n: { kcal: 600 } }] } }
    let n = 0
    expect(copyMeal(S, '2026-11-17', '2026-11-18', 'breakfast', () => 'x' + (++n), 1000)).toBe(1)
    expect(S.foodLog['2026-11-18']).toEqual([{ id: 'x1', meal: 'breakfast', name: 'Porridge', n: { kcal: 400, protein: 15 }, at: 1000 }])
    S.foodLog['2026-11-18'][0].n.kcal = 1
    expect(S.foodLog['2026-11-17'][0].n.kcal).toBe(400)                // a copy, not the same object
    expect(copyMeal(S, '2026-11-17', '2026-11-18', 'dinner', () => 'y')).toBe(0)
  })
  it('stars and unstars foods and recipes, a logged entry finding the same star', () => {
    const S = {}
    const food = { id: 'off:123', src: 'off', name: 'Skyr, Arla', per100: { kcal: 63, protein: 11 } }
    expect(toggleFav(S, food)).toBe(true)
    expect(isFav(S, { src: 'off', ref: 'off:123', name: 'Skyr, Arla' })).toBe(true)
    expect(S.foodFavs[0]).toMatchObject({ key: 'off:off:123', src: 'off', name: 'Skyr, Arla' })
    toggleFav(S, { kind: 'recipe', id: 'r1', name: 'Smoothie' })
    expect(isFav(S, { src: 'recipe', ref: 'r1' })).toBe(true)
    expect(toggleFav(S, food)).toBe(false)
    expect(S.foodFavs.map(f => f.key)).toEqual(['recipe:r1'])
  })
})

describe('proteinNudge', () => {
  const base = {
    nutritionTargets: { kcal: 2900, protein: 150 },
    recipes: [{ id: 'r1', name: 'Recovery smoothie', servings: 1, items: [{ name: 'Whey', grams: 30, per100: { kcal: 400, protein: 80 } }] }],
    foodLog: { '2026-11-18': [{ id: 'a', meal: 'lunch', name: 'Skyr, Arla', src: 'off', ref: 'off:1', grams: 150, per100: { kcal: 63, protein: 11 }, n: { kcal: 95, protein: 16.5 }, at: 1 }] },
  }
  it('says how much is left and names things you eat that cover it', () => {
    expect(proteinNudge(base, '2026-11-18')).toEqual({ need: 134, ideas: ['Recovery smoothie', 'Skyr'] })
  })
  it('stays quiet with nothing logged, no target, or nearly there', () => {
    expect(proteinNudge(base, '2026-11-19')).toBeNull()
    expect(proteinNudge({ ...base, nutritionTargets: { kcal: 2900 } }, '2026-11-18')).toBeNull()
    expect(proteinNudge({ ...base, nutritionTargets: { kcal: 2900, protein: 30 } }, '2026-11-18')).toBeNull()
  })
  it('defaults to off at 7 pm', () => {
    expect(proteinNudgeOf({})).toEqual({ on: false, time: '19:00' })
    expect(proteinNudgeOf({ proteinNudge: { on: true, time: '20:30' } })).toEqual({ on: true, time: '20:30' })
  })
})

describe('the recovery meal', () => {
  it('is a meal of its own, not folded into snacks', () => {
    const e = makeEntry({ id: 'a', meal: 'recovery', quick: { name: 'Shake', kcal: 250, protein: 30 } })
    expect(e.meal).toBe('recovery')
    expect(makeEntry({ id: 'b', meal: 'elevenses', quick: { kcal: 100 } }).meal).toBe('snacks')
  })
})
