import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import CardHead from '../components/CardHead.jsx'
import { Button } from '../components/ui.jsx'
import { findFoodSheet, amountSheet, recipeSheet, targetsSheet, macroLine, MEAL_LABEL } from '../components/FoodSheets.jsx'
import { MEALS, dayEntries, dayTotals, mealTotals, averages, targetsOf, recipeNutrients } from '../lib/nutrition.js'
import { workoutCalories } from '../lib/calories.js'
import { todayISO, isoOf, fmtDate, fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { tappable } from '../lib/use-sheet-keyboard.js'

// GymTrack's Nutrition tab: the day's food by meal against your targets, calories burned in that
// day's workouts beside what you ate, your recipes, and a week's average. lib/nutrition.js holds
// the rules; components/FoodSheets.jsx the sheets.

/** A bar of what you had against a target: "1,840 / 2,900 kcal". */
export function TargetBar({ label, value, target, unit, color }) {
  const pct = target > 0 ? Math.min(100, Math.round(value / target * 100)) : 0
  return <div className="nut-bar">
    <div className="nut-bar-t"><span>{label}</span><b>{fmtNum(Math.round(value))}{target ? ' / ' + fmtNum(target) : ''} {unit}</b></div>
    {target > 0 && <div className="nut-bar-b"><i style={{ width: pct + '%', background: color }} /></div>}
  </div>
}

const shift = (iso, days) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + days); return isoOf(d) }

export default function Nutrition() {
  const S = useStore(s => s.S)
  const [iso, setIso] = useState(todayISO())
  const today = todayISO()
  const tot = dayTotals(S, iso)
  const tg = targetsOf(S)
  const burned = S.workouts.filter(w => w.d === iso).reduce((n, w) => n + (workoutCalories(S, w).kcal || 0), 0)
  const week = averages(S, 7)
  const label = iso === today ? t('Today') : iso === shift(today, -1) ? t('Yesterday') : fmtDate(iso, true)
  return <div className="narrow">
    <div className="hdr">
      <h1>{t('Nutrition')}</h1>
      <button className="iconbtn" onClick={targetsSheet} aria-label={t('Daily targets')}><Icon name="target" /></button>
    </div>

    <div className="card">
      <div className="row between nut-day">
        <button className="iconbtn" onClick={() => setIso(shift(iso, -1))} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{label}</div>
        <button className="iconbtn" disabled={iso >= today} onClick={() => setIso(shift(iso, 1))} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
      </div>
      <TargetBar label={t('Calories')} value={tot.kcal} target={tg?.kcal} unit="kcal" color="var(--orange)" />
      <TargetBar label={t('Protein')} value={tot.protein} target={tg?.protein} unit="g" color="var(--acc)" />
      <TargetBar label={t('Carbs')} value={tot.carbs} target={tg?.carbs} unit="g" color="var(--blue)" />
      <TargetBar label={t('Fat')} value={tot.fat} target={tg?.fat} unit="g" color="var(--teal)" />
      {burned > 0 && <div className="small muted nut-burn"><Icon name="flame" />{t('Burned in workouts: about {0} kcal', burned)}</div>}
      {!tg && <div className="ai-actions"><Button size="sm" variant="tinted" icon="target" onClick={targetsSheet}>{t('Set daily targets')}</Button></div>}
    </div>

    {MEALS.map(meal => {
      const list = dayEntries(S, iso).filter(e => e.meal === meal)
      const mt = mealTotals(S, iso, meal)
      return <div key={meal} className="card nut-meal">
        <div className="row between">
          <div><div className="nut-meal-t">{t(MEAL_LABEL[meal])}</div>{list.length > 0 && <div className="small muted">{t('{0} kcal', mt.kcal)} · {t('{0} g protein', fmtNum(mt.protein))}</div>}</div>
          <Button size="sm" variant="tinted" icon="plus" onClick={() => findFoodSheet({ meal, iso })}>{t('Add')}</Button>
        </div>
        {list.length > 0 && <div className="list">
          {list.map(e => <div key={e.id} className="item" {...tappable(() => amountSheet({ entry: e, iso }))}>
            <div className="grow">
              <div className="tt">{e.name}</div>
              <div className="ss">{[e.src === 'recipe' ? t('{0} servings', fmtNum(e.servings)) : e.grams ? fmtNum(e.grams) + ' g' : null, t('{0} g protein', fmtNum(e.n.protein))].filter(Boolean).join(' · ')}</div>
            </div>
            <b className="nut-kcal">{e.n.kcal}</b>
          </div>)}
        </div>}
      </div>
    })}

    <div className="card">
      <CardHead icon="list" tint="var(--purple)" title={t('Recipes')} sub={t('Your smoothies, shakes and batch cooking, logged by the serving.')}
        action={<Button size="sm" variant="ghost" icon="plus" onClick={() => recipeSheet(null)}>{t('New')}</Button>} />
      {(S.recipes || []).length > 0 && <div className="list">
        {(S.recipes || []).map(r => <div key={r.id} className="item" {...tappable(() => recipeSheet(r))}>
          <div className="grow"><div className="tt">{r.name}</div><div className="ss">{macroLine(recipeNutrients(r).perServing)}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>)}
      </div>}
    </div>

    {week.days > 1 && <div className="card">
      <CardHead icon="chart" tint="var(--blue)" title={t('Last 7 days')} sub={t('Average of the {0} days you logged', week.days)} />
      <div className="small">{macroLine(week.avg)}</div>
    </div>}
  </div>
}
