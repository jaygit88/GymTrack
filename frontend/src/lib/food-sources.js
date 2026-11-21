// Where GymTrack's foods come from:
//   - CoFID (the UK government's Composition of Foods Integrated Dataset, McCance and Widdowson's,
//     Open Government Licence v3.0): ~2,850 generic foods with lab values, bundled in the app
//     (food-data/cofid.json, built by scripts/nutrition/build-cofid.py) and loaded on first search,
//     so it works offline;
//   - Open Food Facts (openfoodfacts.org, Open Database Licence): branded products, by barcode and
//     by name, fetched from the phone when online;
//   - your own foods and recipes (S.foods, S.recipes).
// Search runs on your own foods, recipes and CoFID at once (instant, offline); Open Food Facts is
// asked separately and its answers join when they come.
import { pickNutrients } from './nutrition.js'

const OFF = 'https://world.openfoodfacts.org'
// Open Food Facts' newer search (search-a-licious): about half a second, where the old
// /cgi/search.pl often answers 503 when busy. The old one stays as the fallback.
const OFF_SEARCH = 'https://search.openfoodfacts.org'
// Open Food Facts asks every app to name itself; no personal details.
const USER_AGENT = 'GymTrack/' + (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev') + ' (personal nutrition diary)'
const OFF_FIELDS = 'code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity'

let cofid = null
/** The bundled CoFID list as foods; loaded once. */
export async function loadCofid() {
  if (cofid) return cofid
  const data = (await import('./food-data/cofid.json')).default
  cofid = data.foods.map(([code, name, kcal, protein, carbs, fat, sugars, fibre, satfat, salt]) =>
    ({ id: 'cofid:' + code, src: 'cofid', name, per100: { kcal, protein, carbs, fat, sugars, fibre, satfat, salt } }))
  return cofid
}

const words = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9%]+/).filter(Boolean)

/**
 * Foods matching `q`: every word of the query must start a word of the name ("chick brea" finds
 * "Chicken, breast, grilled"). Your own foods and recipes first, then the generic ones, plain and
 * raw forms before dishes, shorter names before longer. Up to `limit`.
 */
export function searchFoods(q, { mine = [], recipes = [], generic = [], limit = 40 } = {}) {
  const qw = words(q)
  if (!qw.length) return []
  const hits = []
  const consider = (item, tier) => {
    const nw = words(item.name)
    if (!qw.every(w => nw.some(n => n.startsWith(w)))) return
    let score = tier * 1000 + item.name.length
    if (nw[0] && nw[0].startsWith(qw[0])) score -= 200            // the name starts with what you typed
    if (/\braw\b/i.test(item.name)) score -= 50
    if (/\b(homemade|made with|in sauce|dish|with)\b/i.test(item.name)) score += 80
    hits.push({ item, score })
  }
  recipes.forEach(r => consider({ ...r, kind: 'recipe' }, 0))
  mine.forEach(f => consider(f, 0))
  generic.forEach(f => consider(f, 1))
  return hits.sort((a, b) => a.score - b.score).slice(0, limit).map(h => h.item)
}

/** An Open Food Facts product as a food, or null when it has no calories to go on. */
export function offFood(p) {
  if (!p) return null
  const n = p.nutriments || {}
  let kcal = Number(n['energy-kcal_100g'])
  if (!(kcal >= 0) && Number(n.energy_100g) > 0) kcal = Number(n.energy_100g) / 4.184     // kJ only
  if (!(kcal >= 0)) return null
  const v = k => (Number.isFinite(Number(n[k])) ? Math.round(Number(n[k]) * 10) / 10 : null)
  // `brands` is text on the old API ("Tesco, Tesco Finest") and a list on the new search.
  const brand = Array.isArray(p.brands) ? p.brands[0] : p.brands && String(p.brands).split(',')[0]
  const name = [p.product_name_en || p.product_name, brand && String(brand).trim()].filter(Boolean).join(', ')
  if (!name) return null
  const sq = Number(p.serving_quantity)
  return {
    id: 'off:' + p.code, src: 'off', barcode: String(p.code), name: name.slice(0, 120),
    per100: pickNutrients({ kcal: Math.round(kcal), protein: v('proteins_100g'), carbs: v('carbohydrates_100g'), fat: v('fat_100g'),
      sugars: v('sugars_100g'), fibre: v('fiber_100g'), satfat: v('saturated-fat_100g'), salt: v('salt_100g') }),
    ...(sq > 0 && sq < 2000 ? { serving: { g: Math.round(sq * 10) / 10, label: String(p.serving_size || '').slice(0, 40) || null } } : {}),
  }
}

async function getJson(url, { fetchFn, timeoutMs = 9000 } = {}) {
  const f = fetchFn || (async (u, init) => (await import('./capacitor-fetch.js')).nativeFetch(u, init))
  const ctl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = setTimeout(() => ctl?.abort(), timeoutMs)
  try {
    const res = await f(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal: ctl?.signal })
    if (!res.ok) throw Object.assign(new Error('Open Food Facts answered ' + res.status), { code: 'http' })
    return await res.json()
  } catch (e) {
    throw Object.assign(new Error(e?.message || 'offline'), { code: e?.code || 'offline' })
  } finally { clearTimeout(timer) }
}

/** A product by its barcode: the food, or null when Open Food Facts does not know it. */
export async function lookupBarcode(code, opts) {
  const c = String(code || '').replace(/\D/g, '')
  if (c.length < 6) return null
  const d = await getJson(`${OFF}/api/v2/product/${c}.json?fields=${OFF_FIELDS}`, opts)
  return d && d.status !== 0 && d.product ? offFood({ ...d.product, code: d.product.code || c }) : null
}

// Spellings that are one word to a shopper ("yoghurt" on a UK pot, "yogurt" in the search).
const SAME = [/^yog(h)?(o)?urts?$/, /^flavou?rs?$/, /^colou?rs?$/, /^chocs?$|^chocolates?$/]
const norm = w => { for (const re of SAME) if (re.test(w)) return re.source; return w.replace(/s$/, '') }

/**
 * The new search's hits in the order a shopper means: the ones whose name and brand hold the most
 * of the words typed first ("tesco greek yogurt" puts Tesco's Greek yogurt before Tesco's
 * peppers), then products sold in the UK, then the search's own order. With two words or more,
 * hits that match only one of them go to the back.
 */
export function rankProducts(term, hits) {
  const qw = [...new Set(words(term).map(norm))]
  const scored = (hits || []).map((h, i) => {
    const brand = Array.isArray(h?.brands) ? h.brands.join(' ') : h?.brands || ''
    const nw = words((h?.product_name_en || h?.product_name || '') + ' ' + brand).map(norm)
    const score = qw.filter(w => nw.some(n => n.startsWith(w) || w.startsWith(n) && n.length >= 4)).length
    const uk = Array.isArray(h?.countries_tags) && h.countries_tags.includes('en:united-kingdom')
    return { h, i, score, uk }
  })
  const weak = s => qw.length >= 2 && s.score < 2
  return scored.sort((a, b) => weak(a) - weak(b) || b.score - a.score || b.uk - a.uk || a.i - b.i).map(x => x.h)
}

/** Branded products by name, UK ones first. Throws when Open Food Facts cannot be reached at all. */
export async function searchProducts(q, opts = {}) {
  const term = String(q || '').trim()
  if (term.length < 3) return []
  const limit = opts.limit || 20
  try {
    const url = `${OFF_SEARCH}/search?q=${encodeURIComponent(term)}&page_size=50&fields=${OFF_FIELDS},countries_tags`
    const d = await getJson(url, opts)
    const hits = Array.isArray(d?.hits) ? d.hits : []
    return rankProducts(term, hits).map(offFood).filter(Boolean).slice(0, limit)
  } catch (e) {
    // The new search down: the old one, asked twice, since it often answers 503 when busy.
    const old = `${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(term)}&search_simple=1&action=process&json=1&page_size=${limit}` +
      `&fields=${OFF_FIELDS}&countries_tags_en=united-kingdom`
    let d
    try { d = await getJson(old, opts) } catch { d = await getJson(old, opts) }
    return (d?.products || []).map(offFood).filter(Boolean)
  }
}
