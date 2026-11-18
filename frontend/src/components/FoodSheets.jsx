import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { Button, Section, Row, NumberField, SearchField, TextField, Segmented } from './ui.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { MOBILE } from '../lib/mobile.js'
import { uid, fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import {
  MEALS, NUTRIENTS, nutrientsFor, makeEntry, addEntry, removeEntry, updateAmount, recipeNutrients,
  cleanRecipe, recentFoods, suggestTargets, targetsOf, pickNutrients,
} from '../lib/nutrition.js'
import { loadCofid, searchFoods, searchProducts, lookupBarcode } from '../lib/food-sources.js'
import { addExtra } from '../lib/calories.js'

// GymTrack's food sheets (views/Nutrition.jsx): find a food (your own, your recipes, the built-in
// CoFID list, Open Food Facts by name or barcode), say how much, log it; make a food the
// databases do not have; build a recipe; set the day's targets.

const ui = () => useUI.getState()
const update = fn => useStore.getState().update(fn)
export const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' }
// For the string check: t('Breakfast') t('Lunch') t('Dinner') t('Snacks')
const NUTRIENT_LABEL = { kcal: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', sugars: 'Sugars', fibre: 'Fibre', satfat: 'Saturates', salt: 'Salt' }
// t('Calories') t('Protein') t('Carbs') t('Fat') t('Sugars') t('Fibre') t('Saturates') t('Salt')

/** Saves a found food as one of yours (S.foods), so it is there offline and first in searches. */
function keepFood(food) {
  if (!food || food.src === 'cofid' || food.src === 'recipe') return
  update(s => {
    if (!Array.isArray(s.foods)) s.foods = []
    const i = s.foods.findIndex(f => f.id === food.id)
    const keep = { id: food.id, src: food.src, name: food.name, per100: pickNutrients(food.per100), ...(food.serving ? { serving: food.serving } : {}), ...(food.barcode ? { barcode: food.barcode } : {}) }
    if (i < 0) s.foods.push(keep); else s.foods[i] = keep
  })
}

/** A line of the main numbers: "312 kcal · 24 g protein · 30 g carbs · 9 g fat". */
export function macroLine(n) {
  if (!n) return ''
  return [t('{0} kcal', Math.round(n.kcal || 0)), t('{0} g protein', fmtNum(n.protein || 0)), t('{0} g carbs', fmtNum(n.carbs || 0)), t('{0} g fat', fmtNum(n.fat || 0))].join(' · ')
}

/* ---------- how much ---------- */

function Amount({ close, food, recipe, meal, iso, entry, onPick }) {
  const isRecipe = !!recipe || entry?.src === 'recipe'
  const [m, setMeal] = useState(entry?.meal || meal || 'snacks')
  const [amount, setAmount] = useState(entry ? (isRecipe ? entry.servings : entry.grams) : isRecipe ? 1 : (food?.serving?.g || 100))
  const per100 = entry?.per100 || food?.per100
  const n = isRecipe
    ? (() => { const per = entry ? Object.fromEntries(NUTRIENTS.map(k => [k, (entry.n[k] || 0) / (entry.servings || 1)])) : recipeNutrients(recipe).perServing
      return Object.fromEntries(NUTRIENTS.map(k => [k, (per[k] || 0) * (Number(amount) || 0)])) })()
    : nutrientsFor(per100, amount)
  const name = entry?.name || recipe?.name || food?.name
  const save = () => {
    if (!(Number(amount) > 0)) return
    if (onPick) { onPick({ food, grams: Number(amount) }); close(); return }
    if (entry) {
      update(s => {
        updateAmount(s, iso, entry.id, amount)
        const e = (s.foodLog?.[iso] || []).find(x => x.id === entry.id)
        if (e) e.meal = m
      })
    } else {
      keepFood(food)
      update(s => addEntry(s, iso, makeEntry({ id: uid(), meal: m, food, grams: amount, recipe, servings: amount })))
    }
    close()
  }
  return <>
    <h3>{name}</h3>
    {!onPick && <Segmented value={m} onChange={setMeal} options={MEALS.map(x => ({ value: x, label: t(MEAL_LABEL[x]) }))} />}
    <Section>
      <Row title={isRecipe ? t('Servings') : t('Amount')} subtitle={isRecipe ? null : 'g'}>
        <NumberField value={amount} onChange={setAmount} className="food-amt" aria-label={isRecipe ? t('Servings') : t('Amount')} />
      </Row>
      {!isRecipe && food?.serving?.g > 0 && <Row title={food.serving.label || t('1 serving')} subtitle={`${fmtNum(food.serving.g)} g`} accessory="chevron" onClick={() => setAmount(food.serving.g)} />}
    </Section>
    <div className="food-n">
      {NUTRIENTS.map(k => <div key={k} className="food-n-i"><span className="lbl2">{t(NUTRIENT_LABEL[k])}</span><b>{k === 'kcal' ? Math.round(n[k] || 0) : fmtNum(Math.round((n[k] || 0) * 10) / 10) + ' g'}</b></div>)}
    </div>
    <Button variant="primary" onClick={save}>{onPick ? t('Add to recipe') : entry ? t('Save') : t('Add')}</Button>
    {entry && <><div style={{ height: 8 }} /><Button variant="ghost" className="danger" icon="trash" onClick={() => { update(s => removeEntry(s, iso, entry.id)); close() }}>{t('Remove')}</Button></>}
  </>
}
export const amountSheet = props => ui().openSheet(close => <Amount close={close} {...props} />)

/* ---------- a food of your own ---------- */

function NewFood({ close, barcode = null, name: name0 = '', onMade }) {
  const [name, setName] = useState(name0)
  const [per, setPer] = useState('100g')
  const [serving, setServing] = useState(100)
  const [v, setV] = useState({ kcal: null, protein: null, carbs: null, fat: null })
  const save = () => {
    if (!name.trim() || !(Number(v.kcal) >= 0) || v.kcal == null) { ui().toast(t('Give it a name and its calories.')); return }
    const k = per === 'serving' && Number(serving) > 0 ? 100 / Number(serving) : 1
    const per100 = pickNutrients(Object.fromEntries(Object.entries(v).map(([key, x]) => [key, x == null ? null : Math.round(Number(x) * k * 10) / 10])))
    const food = { id: 'mine:' + uid(), src: 'custom', name: name.trim().slice(0, 120), per100, ...(barcode ? { barcode } : {}),
      ...(per === 'serving' && Number(serving) > 0 ? { serving: { g: Number(serving), label: null } } : {}) }
    update(s => { if (!Array.isArray(s.foods)) s.foods = []; s.foods.push(food) })
    close()
    if (onMade) onMade(food)
  }
  return <>
    <h3>{t('New food')}</h3>
    {barcode && <div className="small muted" style={{ marginBottom: 8 }}>{t('Barcode {0} is not in Open Food Facts yet. Add it once and it is yours.', barcode)}</div>}
    <Section>
      <Row title={t('Name')}><TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('e.g. Tesco Greek yogurt')} /></Row>
    </Section>
    <Segmented value={per} onChange={setPer} options={[{ value: '100g', label: t('Per 100 g') }, { value: 'serving', label: t('Per serving') }]} />
    <Section>
      {per === 'serving' && <Row title={t('Serving size')} subtitle="g"><NumberField value={serving} onChange={setServing} className="food-amt" /></Row>}
      {['kcal', 'protein', 'carbs', 'fat'].map(key => <Row key={key} title={t(NUTRIENT_LABEL[key])} subtitle={key === 'kcal' ? 'kcal' : 'g'}>
        <NumberField value={v[key]} nullable onChange={x => setV(o => ({ ...o, [key]: x }))} className="food-amt" />
      </Row>)}
    </Section>
    <Button variant="primary" onClick={save}>{t('Save food')}</Button>
  </>
}
export const newFoodSheet = props => ui().openSheet(close => <NewFood close={close} {...props} />)

/* ---------- quick calories ---------- */

function QuickAdd({ close, meal, iso }) {
  const [name, setName] = useState('')
  const [kcal, setKcal] = useState(null)
  const [protein, setProtein] = useState(null)
  return <>
    <h3>{t('Quick add')}</h3>
    <Section>
      <Row title={t('Name')}><TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('Optional')} /></Row>
      <Row title={t('Calories')} subtitle="kcal"><NumberField value={kcal} nullable onChange={setKcal} className="food-amt" /></Row>
      <Row title={t('Protein')} subtitle="g"><NumberField value={protein} nullable onChange={setProtein} className="food-amt" /></Row>
    </Section>
    <Button variant="primary" onClick={() => {
      if (!(Number(kcal) > 0)) return
      update(s => addEntry(s, iso, makeEntry({ id: uid(), meal, quick: { name: name || t('Quick add'), kcal, protein } })))
      close()
    }}>{t('Add')}</Button>
  </>
}

/* ---------- exercise added by hand ---------- */

// For what the watch and the gym log do not catch (padel, a long walk, a class): a name and its
// calories, counted with that day's workouts and runs (lib/calories.js burnedOn).
function ExtraBurn({ close, iso }) {
  const [name, setName] = useState('')
  const [kcal, setKcal] = useState(null)
  return <>
    <h3>{t('Add exercise')}</h3>
    <p className="small muted">{t('For exercise your watch and workouts did not record. Use the calories your watch or the machine showed, or a fair guess.')}</p>
    <Section>
      <Row title={t('Name')}><TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('e.g. Padel')} /></Row>
      <Row title={t('Calories burned')} subtitle="kcal"><NumberField value={kcal} nullable decimal={false} onChange={setKcal} className="food-amt" /></Row>
    </Section>
    <Button variant="primary" disabled={!(Number(kcal) > 0)} onClick={() => {
      update(s => addExtra(s, iso, { id: uid(), name: name.trim() || t('Exercise'), kcal }))
      close()
    }}>{t('Add')}</Button>
  </>
}
export const extraBurnSheet = iso => ui().openSheet(close => <ExtraBurn close={close} iso={iso} />)

/* ---------- finding a food ---------- */

function FindFood({ close, meal, iso, pick }) {
  const S = useStore(s => s.S)
  const [q, setQ] = useState('')
  const [generic, setGeneric] = useState([])
  const [off, setOff] = useState({ q: '', items: [], state: 'idle' })
  const input = useRef(null)
  useEffect(() => { loadCofid().then(setGeneric).catch(() => {}); setTimeout(() => input.current?.focus(), 250) }, [])
  const mine = S.foods || [], recipes = pick ? [] : (S.recipes || [])
  const local = useMemo(() => searchFoods(q, { mine, recipes, generic }), [q, mine, recipes, generic]) // eslint-disable-line react-hooks/exhaustive-deps
  // Open Food Facts after a pause in typing, so a word is not sent letter by letter.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 3) { setOff({ q: '', items: [], state: 'idle' }); return }
    let live = true
    setOff(o => ({ ...o, state: 'busy' }))
    const tm = setTimeout(() => {
      searchProducts(term).then(items => { if (live) setOff({ q: term, items, state: 'done' }) })
        .catch(() => { if (live) setOff({ q: term, items: [], state: 'error' }) })
    }, 600)
    return () => { live = false; clearTimeout(tm) }
  }, [q])
  const chosen = item => {
    if (item.kind === 'recipe') { close(); amountSheet({ recipe: item, meal, iso }); return }
    close(); amountSheet({ food: item, meal, iso, onPick: pick })
  }
  const scan = async () => {
    try {
      const { scanCode } = await import('../lib/scan.js')
      const code = await scanCode()
      if (!code?.value) return
      const known = (S.foods || []).find(f => f.barcode === code.value)
      const food = known || await lookupBarcode(code.value).catch(() => null)
      close()
      if (food) amountSheet({ food, meal, iso, onPick: pick })
      else newFoodSheet({ barcode: code.value, onMade: f => amountSheet({ food: f, meal, iso, onPick: pick }) })
    } catch (e) { ui().toast(e?.message === 'unsupported' ? t('This phone cannot scan barcodes.') : t('Could not scan. Try again, or search by name.')) }
  }
  const recent = q.trim() ? [] : recentFoods(S, 20)
  const row = (item, key, sub) => <div key={key} className="item" {...{ role: 'button', tabIndex: 0, onClick: () => chosen(item) }}>
    <span className="lrow-i" style={{ width: 32, height: 32 }}><Icon name={item.kind === 'recipe' ? 'list' : item.src === 'off' ? 'barcode' : 'food'} /></span>
    <div className="grow"><div className="tt">{item.name}</div><div className="ss">{sub}</div></div>
  </div>
  const sub100 = f => t('{0} kcal, {1} g protein per 100 g', Math.round(f.per100?.kcal || 0), fmtNum(f.per100?.protein || 0))
  return <>
    <h3>{pick ? t('Add an ingredient') : t('Add to {0}', t(MEAL_LABEL[meal] || 'Snacks'))}</h3>
    <SearchField ref={input} value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder={t('Search foods')} />
    <div className="food-actions">
      {MOBILE && <Button size="sm" variant="tinted" icon="barcode" onClick={scan}>{t('Scan barcode')}</Button>}
      {!pick && <Button size="sm" variant="ghost" icon="flame" onClick={() => { close(); ui().openSheet(c => <QuickAdd close={c} meal={meal} iso={iso} />) }}>{t('Quick add')}</Button>}
      <Button size="sm" variant="ghost" icon="plus" onClick={() => { close(); newFoodSheet({ name: q, onMade: f => amountSheet({ food: f, meal, iso, onPick: pick }) }) }}>{t('New food')}</Button>
    </div>
    <div className="list food-list">
      {recent.length > 0 && <div className="lbl2 food-h">{t('Recent')}</div>}
      {recent.map(e => {
        const item = e.src === 'recipe' ? (S.recipes || []).find(r => r.id === e.ref) && { ...(S.recipes || []).find(r => r.id === e.ref), kind: 'recipe' }
          : { id: e.ref, src: e.src, name: e.name, per100: e.per100, serving: (S.foods || []).find(f => f.id === e.ref)?.serving }
        return item && (!pick || item.kind !== 'recipe') ? row(item, 'r' + e.id, e.src === 'recipe' ? t('{0} servings last time', fmtNum(e.servings)) : t('{0} g last time', fmtNum(e.grams))) : null
      })}
      {local.map(f => row(f, f.id, f.kind === 'recipe' ? t('Recipe, {0} kcal a serving', recipeNutrients(f).perServing.kcal) : sub100(f)))}
      {q.trim().length >= 3 && <div className="lbl2 food-h">{t('Branded products')} {off.state === 'busy' && '…'}</div>}
      {off.state === 'error' && <div className="small muted">{t('Open Food Facts cannot be reached right now. Your foods and the built-in list still work.')}</div>}
      {off.state === 'done' && !off.items.length && <div className="small muted">{t('No branded products found.')}</div>}
      {off.items.filter(f => !local.some(l => l.id === f.id)).map(f => row(f, f.id, sub100(f)))}
    </div>
    <div className="small dim food-credit">{t('Food data: CoFID (UK Government, Open Government Licence) and Open Food Facts (Open Database Licence).')}</div>
  </>
}
export const findFoodSheet = props => ui().openSheet(close => <FindFood close={close} {...props} />)

/* ---------- recipes ---------- */

function RecipeEditor({ close, recipe }) {
  const [r, setR] = useState(() => recipe ? JSON.parse(JSON.stringify(recipe)) : { id: null, name: '', servings: 1, items: [] })
  const totals = recipeNutrients(r)
  const addItem = () => findFoodSheet({ pick: ({ food, grams }) => setR(x => ({ ...x, items: [...x.items, { name: food.name, src: food.src, ref: food.id, grams, per100: food.per100 }] })) })
  const save = () => {
    const clean = cleanRecipe(r)
    if (!clean.name || !clean.items.length) { ui().toast(t('Give the recipe a name and at least one ingredient.')); return }
    update(s => {
      if (!Array.isArray(s.recipes)) s.recipes = []
      if (clean.id) { const i = s.recipes.findIndex(x => x.id === clean.id); if (i >= 0) s.recipes[i] = clean; else s.recipes.push(clean) }
      else s.recipes.push({ ...clean, id: 'rec:' + uid() })
    })
    close()
  }
  return <>
    <h3>{recipe ? t('Edit recipe') : t('New recipe')}</h3>
    <Section>
      <Row title={t('Name')}><TextField value={r.name} onChange={e => setR(x => ({ ...x, name: e.target.value }))} placeholder={t('e.g. Recovery smoothie')} /></Row>
      <Row title={t('Servings')} subtitle={t('How many portions it makes')}><NumberField value={r.servings} onChange={v => setR(x => ({ ...x, servings: v }))} className="food-amt" decimal={false} /></Row>
    </Section>
    <Section title={t('Ingredients')}>
      {r.items.map((i, n) => <div key={n} className="lrow">
        <span className="lrow-m"><span className="lrow-t">{i.name}</span><span className="lrow-s">{t('{0} kcal', Math.round(nutrientsFor(i.per100, i.grams).kcal))}</span></span>
        <NumberField value={i.grams} onChange={v => setR(x => ({ ...x, items: x.items.map((y, k) => (k === n ? { ...y, grams: v } : y)) }))} className="food-amt" aria-label={t('Amount')} />
        <span className="small muted">g</span>
        <button type="button" className="iconbtn" aria-label={t('Remove')} onClick={() => setR(x => ({ ...x, items: x.items.filter((_, k) => k !== n) }))}><Icon name="xmark" /></button>
      </div>)}
      <Row icon="plus" iconTint="var(--acc)" title={t('Add ingredient')} accessory="chevron" onClick={addItem} />
    </Section>
    {r.items.length > 0 && <div className="small muted" style={{ margin: '0 4px 12px' }}>{t('A serving: {0}', macroLine(totals.perServing))}</div>}
    <Button variant="primary" onClick={save}>{t('Save recipe')}</Button>
    {recipe && <><div style={{ height: 8 }} /><Button variant="ghost" className="danger" icon="trash" onClick={() => { update(s => { s.recipes = (s.recipes || []).filter(x => x.id !== recipe.id) }); close() }}>{t('Delete recipe')}</Button></>}
  </>
}
export const recipeSheet = recipe => ui().openSheet(close => <RecipeEditor close={close} recipe={recipe} />)

/* ---------- targets ---------- */

function Targets({ close }) {
  const S = useStore(s => s.S)
  const cur = targetsOf(S) || {}
  const sug = suggestTargets(S)
  const [v, setV] = useState({ kcal: cur.kcal || null, protein: cur.protein || null, carbs: cur.carbs || null, fat: cur.fat || null })
  return <>
    <h3>{t('Daily targets')}</h3>
    {sug && <div className="small muted" style={{ marginBottom: 8 }}>{t('For gaining muscle at your weight: about {0} kcal and {1} g protein a day. Adjust by what the scale does over a few weeks.', sug.kcal, sug.protein)}</div>}
    <Section>
      {['kcal', 'protein', 'carbs', 'fat'].map(key => <Row key={key} title={t(NUTRIENT_LABEL[key])} subtitle={key === 'kcal' ? 'kcal' : (key === 'protein' ? 'g' : t('g, optional'))}>
        <NumberField value={v[key]} nullable onChange={x => setV(o => ({ ...o, [key]: x }))} className="food-amt" decimal={false} />
      </Row>)}
    </Section>
    {sug && <><Button variant="tinted" onClick={() => setV(o => ({ ...o, kcal: sug.kcal, protein: sug.protein }))}>{t('Use the suggestion')}</Button><div style={{ height: 8 }} /></>}
    <Button variant="primary" onClick={() => { update(s => { s.nutritionTargets = v.kcal > 0 ? v : null }); close() }}>{t('Save')}</Button>
  </>
}
export const targetsSheet = () => ui().openSheet(close => <Targets close={close} />)
