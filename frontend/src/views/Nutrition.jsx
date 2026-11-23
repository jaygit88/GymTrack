import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import CardHead from '../components/CardHead.jsx'
import { Button } from '../components/ui.jsx'
import { findFoodSheet, amountSheet, recipeSheet, targetsSheet, extraBurnSheet, macroLine, MEAL_LABEL } from '../components/FoodSheets.jsx'
import { MEALS, dayEntries, dayTotals, mealTotals, averages, targetsOf, recipeNutrients, dayBudget, copyMeal } from '../lib/nutrition.js'
import { burnedOn, extraOn, removeExtra, runCalorieInfo, workoutCalories } from '../lib/calories.js'
import { runsOn, runDistance } from '../lib/runs.js'
import { todayISO, isoOf, fmtDate, fmtNum, uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { aiChatSheet } from '../components/AiChatSheet.jsx'

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

/**
 * Calories against the day's budget, stacked: the target, then what exercise added on top (a
 * lighter stretch of the bar), filled by what you ate. "1,840 / 3,120 kcal", and under it
 * "2,900 + 220 from exercise".
 */
export function CalorieBar({ value, budget }) {
  if (!budget) return <TargetBar label={t('Calories')} value={value} unit="kcal" color="var(--orange)" />
  const { base, earned, total } = budget
  const pct = Math.min(100, value / total * 100)
  const basePct = base / total * 100
  const over = value > total
  return <div className="nut-bar">
    <div className="nut-bar-t"><span>{t('Calories')}</span><b>{fmtNum(Math.round(value))} / {fmtNum(total)} kcal</b></div>
    <div className="nut-bar-b nut-bar-stack">
      {earned > 0 && <span className="nut-bar-earned" style={{ left: basePct + '%' }} />}
      <i style={{ width: pct + '%', background: over ? 'var(--red)' : 'var(--orange)' }} />
      {earned > 0 && <span className="nut-bar-tick" style={{ left: basePct + '%' }} />}
    </div>
    <div className="nut-bar-s">{earned > 0
      ? t('{0} target + {1} from exercise', fmtNum(base), fmtNum(earned))
      : value <= total ? t('{0} kcal left', fmtNum(total - Math.round(value))) : t('{0} kcal over', fmtNum(Math.round(value) - total))}
      {earned > 0 && <span> · {value <= total ? t('{0} kcal left', fmtNum(total - Math.round(value))) : t('{0} kcal over', fmtNum(Math.round(value) - total))}</span>}</div>
  </div>
}

const shift = (iso, days) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + days); return isoOf(d) }

export default function Nutrition() {
  const S = useStore(s => s.S)
  const [iso, setIso] = useState(todayISO())
  const today = todayISO()
  const tot = dayTotals(S, iso)
  const tg = targetsOf(S)
  const burned = burnedOn(S, iso)
  const budget = dayBudget(S, iso)
  const extras = extraOn(S, iso)
  const runs = runsOn(S, iso)
  // Why a run has no calories, and what fixes it (lib/calories.js runCalorieInfo).
  const workouts = S.workouts.filter(w => w && w.d === iso)
  const assumedAge = [...workouts.map(w => workoutCalories(S, w)), ...runs.map(r => runCalorieInfo(S, r))].some(x => x.assumed === 'age')
  const MISSING = {
    hr: () => t('No heart rate for this one. Wear the watch with the GymTrack watch app open to get one.'),
    time: () => t('Too short to count.'),
    calories: () => t('No calories from Samsung Health yet. In Settings, Health Connect, turn Runs from your watch off and on to allow them.'),
    weight: () => t('Log your weight once to see the calories.'),
    age: () => t('Add your year of birth in Settings, About you, to see the calories.'),
  }
  const update = useStore(s => s.update)
  const week = averages(S, 7)
  const label = iso === today ? t('Today') : iso === shift(today, -1) ? t('Yesterday') : fmtDate(iso, true)
  return <div className="narrow">
    <div className="hdr">
      <h1>{t('Nutrition')}</h1>
      <div className="row" style={{ gap: 8 }}>
        <button className="iconbtn" onClick={() => aiChatSheet({ screen: 'nutrition', iso })} aria-label={t('Ask GymTrackAI')}><Icon name="sparkles" /></button>
        <button className="iconbtn" onClick={targetsSheet} aria-label={t('Daily targets')}><Icon name="target" /></button>
      </div>
    </div>

    <div className="card">
      <div className="row between nut-day">
        <button className="iconbtn" onClick={() => setIso(shift(iso, -1))} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{label}</div>
        <button className="iconbtn" disabled={iso >= today} onClick={() => setIso(shift(iso, 1))} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
      </div>
      <CalorieBar value={tot.kcal} budget={budget} />
      <TargetBar label={t('Protein')} value={tot.protein} target={tg?.protein} unit="g" color="var(--acc)" />
      <TargetBar label={t('Carbs')} value={tot.carbs} target={tg?.carbs} unit="g" color="var(--blue)" />
      <TargetBar label={t('Fat')} value={tot.fat} target={tg?.fat} unit="g" color="var(--teal)" />
      {!tg && <div className="ai-actions"><Button size="sm" variant="tinted" icon="target" onClick={targetsSheet}>{t('Set daily targets')}</Button></div>}
    </div>

    {MEALS.map(meal => {
      const list = dayEntries(S, iso).filter(e => e.meal === meal)
      const mt = mealTotals(S, iso, meal)
      // An empty meal offers the same one as the day before, in one tap.
      const prev = shift(iso, -1)
      const prevMeal = list.length ? null : mealTotals(S, prev, meal)
      return <div key={meal} className="card nut-meal">
        <div className="row between">
          <div><div className="nut-meal-t">{t(MEAL_LABEL[meal])}</div>{list.length > 0
            ? <div className="small muted">{t('{0} kcal', fmtNum(mt.kcal))} · {t('{0} g protein', fmtNum(mt.protein))}</div>
            : meal === 'recovery' && <div className="small muted">{t('Shakes, smoothies and drinks after training')}</div>}</div>
          <Button size="sm" variant="tinted" icon="plus" onClick={() => findFoodSheet({ meal, iso })}>{t('Add')}</Button>
        </div>
        {prevMeal?.kcal > 0 && <button className="food-copy" onClick={() => update(s => copyMeal(s, prev, iso, meal, uid))}>
          <Icon name="copy" /> {t('Same as the day before')} <span className="muted">· {t('{0} kcal', prevMeal.kcal)}</span>
        </button>}
        {list.length > 0 && <div className="list">
          {list.map(e => <div key={e.id} className="item" {...tappable(() => amountSheet({ entry: e, iso }))}>
            <div className="grow">
              <div className="tt">{e.name}</div>
              <div className="ss">{[e.src === 'recipe' ? t('{0} servings', fmtNum(e.servings)) : e.grams ? fmtNum(e.grams) + ' g' : null, t('{0} g protein', fmtNum(e.n.protein))].filter(Boolean).join(' · ')}</div>
            </div>
            <b className="nut-kcal">{fmtNum(e.n.kcal)}</b>
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

    <div className="card nut-meal">
      <div className="row between">
        <div><div className="nut-meal-t">{t('Exercise')}</div>{burned.total > 0 && <div className="small muted">{t('About {0} kcal burned', burned.total)}{budget?.earned > 0 ? ' · ' + t('{0} added to today', fmtNum(budget.earned)) : ''}</div>}</div>
        <Button size="sm" variant="tinted" icon="plus" onClick={() => extraBurnSheet(iso)}>{t('Add')}</Button>
      </div>
      {(burned.total > 0 || runs.length > 0 || workouts.length > 0) && <div className="list">
        {workouts.map((w, i) => {
          const c = workoutCalories(S, w)
          return <div key={w.id || i} className="item"><div className="grow">
            <div className="tt">{w.name || t('Workout')}</div>
            <div className="ss">{c.kcal ? t('From your heart rate') : MISSING[c.missing]?.()}</div>
          </div><b className="nut-kcal">{c.kcal ? fmtNum(c.kcal) : '–'}</b></div>
        })}
        {runs.map(r => {
          const info = runCalorieInfo(S, r), dist = runDistance(r, S.unit)
          return <div key={r.id} className="item"><div className="grow">
            <div className="tt">{r.title || t('Run')}{dist ? ' · ' + fmtNum(dist.value) + ' ' + dist.unit : ''}</div>
            <div className="ss">{info.kcal ? (info.from === 'hr' ? t('From your heart rate') : t('From Samsung Health')) : MISSING[info.missing]?.()}</div>
          </div><b className="nut-kcal">{info.kcal ? fmtNum(info.kcal) : '–'}</b></div>
        })}
        {extras.map(x => <div key={x.id} className="item">
          <div className="grow"><div className="tt">{x.name}</div><div className="ss">{t('Added by you')}</div></div>
          <b className="nut-kcal">{x.kcal}</b>
          <button className="iconbtn" aria-label={t('Remove')} onClick={() => update(s => removeExtra(s, iso, x.id))}><Icon name="xmark" /></button>
        </div>)}
      </div>}
      {assumedAge && <div className="small muted" style={{ marginTop: 8 }}>{t('Worked out for age 35. Add your year of birth in Settings, About you, for a closer number.')}{' '}
        <button className="linkbtn" onClick={async () => (await import('../components/StrengthLevel.jsx')).aboutYouSheet()}>{t('Add it now')}</button></div>}
    </div>
  </div>
}
