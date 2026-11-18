// GymTrack's nutrition: a food diary by day and meal, your own foods, recipes (a recovery smoothie,
// a batch of chilli) and daily targets for gaining muscle. Pure: state in, state out.
//
// State (synced and backed up like everything else):
//   S.foodLog          { 'YYYY-MM-DD': [entry] }
//   S.foods            [food]       your own foods, and products scanned or found once
//   S.recipes          [recipe]
//   S.nutritionTargets { kcal, protein, carbs?, fat? } or null
//
// A food: { id, src: 'cofid' | 'off' | 'custom', name, per100: Nutrients, serving?: { g, label } }
// An entry: { id, meal, name, src, ref, grams?, servings?, n: Nutrients, at }. `n` is the snapshot of
// what was eaten, worked out when it was logged, so a food edited later does not rewrite history.
// A recipe: { id, name, servings, items: [{ name, src, ref, grams, per100 }] }, eaten by servings.
// Nutrients: { kcal, protein, carbs, fat, sugars, fibre, satfat, salt } in kcal and grams.

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks']
export const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat', 'sugars', 'fibre', 'satfat', 'salt']
const LB_PER_KG = 2.2046226218
const DAY = 86400e3

const r1 = n => Math.round(n * 10) / 10
const zero = () => Object.fromEntries(NUTRIENTS.map(k => [k, 0]))

/** What `grams` of a food with these per-100 g values hold. Unknown values count as 0. */
export function nutrientsFor(per100, grams) {
  const out = {}
  const g = Math.max(0, Number(grams) || 0)
  for (const k of NUTRIENTS) out[k] = r1((Number(per100?.[k]) || 0) * g / 100)
  out.kcal = Math.round(out.kcal)
  return out
}

/** Add nutrient objects together. */
export function sum(list) {
  const out = zero()
  for (const n of list || []) for (const k of NUTRIENTS) out[k] += Number(n?.[k]) || 0
  for (const k of NUTRIENTS) out[k] = k === 'kcal' ? Math.round(out[k]) : r1(out[k])
  return out
}

/* ---------- recipes ---------- */

/** A recipe's whole batch, its weight, and one serving: { total, grams, perServing, per100 }. */
export function recipeNutrients(recipe) {
  const items = Array.isArray(recipe?.items) ? recipe.items : []
  const total = sum(items.map(i => nutrientsFor(i.per100, i.grams)))
  const grams = items.reduce((g, i) => g + (Number(i.grams) || 0), 0)
  const servings = Math.max(1, Number(recipe?.servings) || 1)
  const perServing = {}
  for (const k of NUTRIENTS) perServing[k] = k === 'kcal' ? Math.round(total[k] / servings) : r1(total[k] / servings)
  const per100 = {}
  for (const k of NUTRIENTS) per100[k] = grams > 0 ? r1(total[k] * 100 / grams) : 0
  return { total, grams, perServing, per100 }
}

/** A recipe cleaned for saving: a name, 1 to 50 servings, items with a food and a weight. */
export function cleanRecipe(r) {
  const items = (Array.isArray(r?.items) ? r.items : []).filter(i => i && i.per100 && Number(i.grams) > 0)
    .map(i => ({ name: String(i.name || '').slice(0, 120), src: i.src || 'custom', ref: i.ref || null, grams: r1(Number(i.grams)), per100: pickNutrients(i.per100) }))
  return { id: r?.id || null, name: String(r?.name || '').trim().slice(0, 80), servings: Math.max(1, Math.min(50, Math.round(Number(r?.servings) || 1))), items }
}

export const pickNutrients = n => Object.fromEntries(NUTRIENTS.map(k => [k, Number.isFinite(Number(n?.[k])) && n?.[k] != null ? Number(n[k]) : null]))

/* ---------- the diary ---------- */

/** One logged food: a food by weight, or a recipe by servings, or quick calories (name and kcal only). */
export function makeEntry({ id, meal, food, grams, recipe, servings, quick, at = Date.now() }) {
  const m = MEALS.includes(meal) ? meal : 'snacks'
  if (recipe) {
    const s = Math.max(0.25, Number(servings) || 1)
    const per = recipeNutrients(recipe).perServing
    const n = {}
    for (const k of NUTRIENTS) n[k] = k === 'kcal' ? Math.round(per[k] * s) : r1(per[k] * s)
    return { id, meal: m, name: recipe.name, src: 'recipe', ref: recipe.id, servings: s, n, at }
  }
  if (quick) {
    const n = zero()
    n.kcal = Math.max(0, Math.round(Number(quick.kcal) || 0))
    n.protein = Math.max(0, r1(Number(quick.protein) || 0))
    return { id, meal: m, name: String(quick.name || '').trim() || 'Quick add', src: 'quick', ref: null, n, at }
  }
  const g = Math.max(0, Number(grams) || 0)
  return { id, meal: m, name: food.name, src: food.src, ref: food.id, grams: r1(g), per100: pickNutrients(food.per100), n: nutrientsFor(food.per100, g), at }
}

export const dayEntries = (S, iso) => (S?.foodLog?.[iso] || []).filter(Boolean)

/** S.foodLog[iso] with the entry added (mutates S). */
export function addEntry(S, iso, entry) {
  if (!S.foodLog || typeof S.foodLog !== 'object') S.foodLog = {}
  S.foodLog[iso] = [...dayEntries(S, iso), entry]
}
export function removeEntry(S, iso, id) {
  if (!S.foodLog?.[iso]) return
  S.foodLog[iso] = S.foodLog[iso].filter(e => e && e.id !== id)
  if (!S.foodLog[iso].length) delete S.foodLog[iso]
}
/** Change how much of a logged food (grams) or recipe (servings) was eaten; the snapshot follows. */
export function updateAmount(S, iso, id, amount) {
  const e = dayEntries(S, iso).find(x => x.id === id)
  if (!e) return
  if (e.src === 'recipe') {
    const old = e.servings || 1, s = Math.max(0.25, Number(amount) || 1)
    for (const k of NUTRIENTS) e.n[k] = k === 'kcal' ? Math.round(e.n[k] * s / old) : r1(e.n[k] * s / old)
    e.servings = s
  } else if (e.per100) {
    e.grams = r1(Math.max(0, Number(amount) || 0))
    e.n = nutrientsFor(e.per100, e.grams)
  }
}

export const dayTotals = (S, iso) => sum(dayEntries(S, iso).map(e => e.n))
export const mealTotals = (S, iso, meal) => sum(dayEntries(S, iso).filter(e => e.meal === meal).map(e => e.n))

/** The average day over the last `days`, counting only days with something logged: { days, avg }. */
export function averages(S, days = 7, now = Date.now()) {
  const logged = []
  for (let i = 0; i < days; i++) {
    const d = new Date(now - i * DAY)
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    if (dayEntries(S, iso).length) logged.push(dayTotals(S, iso))
  }
  if (!logged.length) return { days: 0, avg: null }
  const t = sum(logged), avg = {}
  for (const k of NUTRIENTS) avg[k] = k === 'kcal' ? Math.round(t[k] / logged.length) : r1(t[k] / logged.length)
  return { days: logged.length, avg }
}

/** Foods and recipes you logged lately, most recent first, each once, with the amount you last had. */
export function recentFoods(S, n = 30) {
  const all = Object.entries(S?.foodLog || {}).flatMap(([iso, list]) => (list || []).map(e => ({ ...e, iso })))
    .filter(e => e && e.src !== 'quick').sort((a, b) => (b.at || 0) - (a.at || 0))
  const seen = new Set(), out = []
  for (const e of all) {
    const key = e.src + ':' + (e.ref || e.name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
    if (out.length >= n) break
  }
  return out
}

/* ---------- targets ---------- */

/** Your weight in kg from the latest weigh-in, or null. */
export function weightKg(S) {
  const b = (S?.bodyweight || []).filter(x => x && +x.w > 0)
  if (!b.length) return null
  const w = +b[b.length - 1].w
  return S?.unit === 'lb' ? w / LB_PER_KG : w
}

/**
 * A starting point for gaining muscle while training most days: protein 1.8 g per kg of body
 * weight (the middle of the 1.6 to 2.2 g range the research supports), calories about 33 per kg
 * (maintenance for someone lifting and running) plus 250 for a slow, lean gain. Rounded, and
 * meant to be adjusted by what the scale does. Null without a weigh-in.
 */
export function suggestTargets(S) {
  const kg = weightKg(S)
  if (!kg) return null
  return { kcal: Math.round((kg * 33 + 250) / 50) * 50, protein: Math.round(kg * 1.8 / 5) * 5 }
}

export function targetsOf(S) {
  const t = S?.nutritionTargets
  if (!t || !(t.kcal > 0)) return null
  return { kcal: Math.round(t.kcal), protein: t.protein > 0 ? Math.round(t.protein) : null, carbs: t.carbs > 0 ? Math.round(t.carbs) : null, fat: t.fat > 0 ? Math.round(t.fat) : null }
}

/**
 * The food diary over the last `days` for GymTrackAI: how many days were logged, the average
 * logged day against the targets, and what the workouts on those days burned. Null when nothing
 * was logged, so a month without the diary says nothing about food. `burnedOn(iso)` gives a day's
 * workout calories (lib/calories.js, passed in to keep this file free of it).
 */
export function nutritionSummary(S, { days = 30, now = Date.now(), burnedOn = () => 0 } = {}) {
  const { days: logged, avg } = averages(S, days, now)
  if (!logged) return null
  let burned = 0
  for (let i = 0; i < days; i++) {
    const d = new Date(now - i * DAY)
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    if (dayEntries(S, iso).length) burned += Number(burnedOn(iso)) || 0
  }
  const tg = targetsOf(S)
  return {
    daysLogged: logged, ofDays: days,
    averageDay: { kcal: avg.kcal, proteinG: avg.protein, carbsG: avg.carbs, fatG: avg.fat },
    ...(tg ? { targets: { kcal: tg.kcal, ...(tg.protein ? { proteinG: tg.protein } : {}) } } : {}),
    ...(burned > 0 ? { averageBurnedInWorkoutsKcal: Math.round(burned / logged) } : {}),
  }
}
