// Reading a nutrition label from a photo with GymTrackAI (Claude), for a food that Open Food
// Facts and the built-in list do not have. Pure: the prompt, the answer's shape and the checks.
// lib/ai-review-run.js runLabelRead sends the photo; components/FoodSheets.jsx NewFood fills its
// form with the result for you to check before saving it as your own food (S.foods).
//
// UK and EU labels give values per 100 g (or 100 ml), often with a per-serving column beside
// them. A label with only per-serving values is turned into per 100 g using its serving size.
// Energy comes back in kcal; a label with only kJ is divided by 4.184.
import { pickNutrients } from './nutrition.js'

const KEYS = ['kcal', 'protein', 'carbs', 'sugars', 'fat', 'satfat', 'fibre', 'salt']
const r1 = n => Math.round(n * 10) / 10

const NUTRIENTS_SCHEMA = {
  type: ['object', 'null'], additionalProperties: false, required: KEYS,
  properties: Object.fromEntries(KEYS.map(k => [k, { type: ['number', 'null'] }])),
}
export const LABEL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['readable', 'name', 'per100g', 'perServing', 'servingG', 'problem'],
  properties: {
    readable: { type: 'boolean' },
    name: { type: 'string' },
    per100g: NUTRIENTS_SCHEMA,
    perServing: NUTRIENTS_SCHEMA,
    servingG: { type: ['number', 'null'] },
    problem: { type: 'string' },
  },
}

/** The system and user text for one label photo. */
export function buildLabelPrompt({ name = '', langName = 'English' } = {}) {
  return {
    system: [
      'You read food packaging photos for a nutrition diary.',
      'Find the nutrition table and copy its numbers exactly; never estimate a value that is not printed.',
      '"per100g": the per 100 g (or per 100 ml) column, with kcal (if only kJ is printed, divide by 4.184), protein, carbs (carbohydrate), sugars (of which sugars), fat, satfat (of which saturates), fibre and salt, all in grams. A value not on the label is null. Null for the whole object if there is no per 100 g column.',
      '"perServing": the per serving (or per portion, per pack) column, the same way, or null. "servingG": the serving size in grams or ml if printed, else null.',
      '"name": the product name and brand if they are visible (for example "Greek style yogurt, Tesco"), else an empty string.',
      '"readable": false if there is no nutrition table or it cannot be read; then say why in "problem" in a few words (in ' + langName + '). Otherwise "problem" is an empty string.',
      'Return exactly one JSON object and nothing else: {"readable": boolean, "name": string, "per100g": {...} | null, "perServing": {...} | null, "servingG": number | null, "problem": string}.',
    ].join('\n'),
    user: 'Read the nutrition label in this photo.' + (name ? ` The person thinks the product is "${String(name).slice(0, 80)}".` : ''),
  }
}

const clean = n => {
  if (!n || typeof n !== 'object') return null
  const out = {}
  for (const k of KEYS) { const v = Number(n[k]); out[k] = n[k] == null || !Number.isFinite(v) || v < 0 ? null : v }
  return out.kcal == null ? null : out
}
// Per 100 g a food cannot hold more than 100 g of anything, nor much more than 900 kcal (pure fat).
const plausible = n => n && n.kcal <= 950 && KEYS.every(k => k === 'kcal' || n[k] == null || n[k] <= 100) &&
  (n.protein || 0) + (n.carbs || 0) + (n.fat || 0) <= 110

/**
 * The label as a food to check and save: { ok, name, per100, serving } or { ok: false, problem }.
 * Values per 100 g, rounded to one decimal (kcal whole); `serving` ({ g }) when the label gave one.
 */
export function checkLabel(v) {
  if (!v || v.readable === false) return { ok: false, problem: String(v?.problem || '').slice(0, 160) }
  const servingG = Number(v.servingG) > 0 && Number(v.servingG) < 2000 ? r1(Number(v.servingG)) : null
  let per100 = clean(v.per100g)
  if (!per100) {
    const ps = clean(v.perServing)
    if (ps && servingG) per100 = Object.fromEntries(KEYS.map(k => [k, ps[k] == null ? null : ps[k] * 100 / servingG]))
  }
  if (!per100 || !plausible(per100)) return { ok: false, problem: '' }
  const rounded = Object.fromEntries(KEYS.map(k => [k, per100[k] == null ? null : k === 'kcal' ? Math.round(per100[k]) : r1(per100[k])]))
  return { ok: true, name: String(v.name || '').trim().slice(0, 120), per100: pickNutrients(rounded), ...(servingG ? { serving: { g: servingG } } : {}) }
}

/**
 * A photo made small enough to send: the long side at most `max` px, as JPEG, base64 without the
 * data: prefix. Labels stay readable at 1,568 px, Anthropic's own suggested limit.
 */
export async function photoForModel(file, { max = 1568, quality = 0.85 } = {}) {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  const url = canvas.toDataURL('image/jpeg', quality)
  return { mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) }
}
