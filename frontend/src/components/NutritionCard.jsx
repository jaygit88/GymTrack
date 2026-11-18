import { useNavigate } from 'react-router-dom'
import CardHead from './CardHead.jsx'
import Icon from './Icon.jsx'
import { TargetBar } from '../views/Nutrition.jsx'
import { dayTotals, targetsOf } from '../lib/nutrition.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'

// GymTrack: today's food at a glance on Home (calories and protein against your targets), a tap
// to the Nutrition tab. Shown once you have logged food or set targets.
export default function NutritionCard({ S }) {
  const nav = useNavigate()
  const tg = targetsOf(S)
  const today = todayISO()
  const tot = dayTotals(S, today)
  if (!tg && !Object.keys(S.foodLog || {}).length) return null
  return <div className="card tap-host nut-card">
    <CardHead icon="food" tint="var(--orange)" title={t('Nutrition')} sub={t('{0} kcal today', tot.kcal)} open={{ onClick: () => nav('/nutrition') }}
      action={<Icon name="chevronRight" className="chev" />} />
    <TargetBar label={t('Calories')} value={tot.kcal} target={tg?.kcal} unit="kcal" color="var(--orange)" />
    <TargetBar label={t('Protein')} value={tot.protein} target={tg?.protein} unit="g" color="var(--acc)" />
  </div>
}
