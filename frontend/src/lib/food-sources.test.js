import { describe, it, expect, vi } from 'vitest'
import { loadCofid, searchFoods, offFood, lookupBarcode, searchProducts } from './food-sources.js'

describe('the bundled CoFID list', () => {
  it('loads as foods with values per 100 g', async () => {
    const foods = await loadCofid()
    expect(foods.length).toBeGreaterThan(2500)
    const f = foods.find(x => /^Banana/i.test(x.name))
    expect(f.src).toBe('cofid')
    expect(f.per100.kcal).toBeGreaterThan(50)
  })
})

describe('searchFoods', () => {
  const generic = [
    { id: 'g1', name: 'Chicken, breast, grilled without skin, meat only', per100: {} },
    { id: 'g2', name: 'Chicken in white sauce, made with semi-skimmed milk', per100: {} },
    { id: 'g3', name: 'Banana, flesh only', per100: {} },
  ]
  const mine = [{ id: 'm1', name: 'Chicken breast, Tesco', per100: {} }]
  const recipes = [{ id: 'r1', name: 'Chicken stir fry', servings: 2, items: [] }]
  it('matches word starts, yours first, plain before dishes', () => {
    const r = searchFoods('chick brea', { mine, recipes, generic })
    expect(r.map(x => x.id)).toEqual(['m1', 'g1'])
    expect(searchFoods('chicken', { mine, recipes, generic }).map(x => x.id)).toEqual(['r1', 'm1', 'g1', 'g2'])
    expect(searchFoods('', { generic })).toEqual([])
  })
  it('finds real CoFID foods', async () => {
    const r = searchFoods('oats', { generic: await loadCofid() })
    expect(r.length).toBeGreaterThan(0)
  })
})

describe('Open Food Facts', () => {
  const product = { code: '5000159484695', product_name: 'Twix', brands: 'Mars,Twix', serving_quantity: 43, serving_size: '1 bar (43 g)',
    nutriments: { 'energy-kcal_100g': 495, proteins_100g: 4.5, carbohydrates_100g: 63, fat_100g: 24, sugars_100g: 49, 'saturated-fat_100g': 14, salt_100g: 0.4 } }
  it('reads a product as a food', () => {
    expect(offFood(product)).toMatchObject({ id: 'off:5000159484695', name: 'Twix, Mars', per100: { kcal: 495, protein: 4.5, fibre: null }, serving: { g: 43 } })
    expect(offFood({ code: '1', product_name: 'x', nutriments: { energy_100g: 418.4 } }).per100.kcal).toBe(100)
    expect(offFood({ code: '1', product_name: 'x', nutriments: {} })).toBeNull()
  })
  it('looks up a barcode, and says so when the product is unknown', async () => {
    const fetchFn = vi.fn(async url => ({ ok: true, json: async () => (url.includes('5000159484695') ? { status: 1, product } : { status: 0 }) }))
    expect((await lookupBarcode('5000159484695', { fetchFn })).name).toBe('Twix, Mars')
    expect(await lookupBarcode('4000000000000', { fetchFn })).toBeNull()
    expect(fetchFn.mock.calls[0][0]).toContain('/api/v2/product/5000159484695.json')
  })
  it('searches by name, and throws when it cannot reach the service', async () => {
    const ok = vi.fn(async () => ({ ok: true, json: async () => ({ products: [product, { code: '2' }] }) }))
    expect(await searchProducts('twix', { fetchFn: ok })).toHaveLength(1)
    expect(ok.mock.calls[0][0]).toContain('countries_tags_en=united-kingdom')
    const down = vi.fn(async () => ({ ok: false, status: 503 }))
    await expect(searchProducts('twix', { fetchFn: down })).rejects.toThrow(/503/)
  })
})
