import { useNavigate } from 'react-router-dom'
import BodyMap from './BodyMap.jsx'
import Icon from './Icon.jsx'
import { loadOfWorkouts } from '../lib/muscles.js'
import { setsDone } from '../lib/history.js'
import { glyphOf } from '../lib/glyphs.js'
import { isoOf, todayISO, durPart, DAYS, DAYN } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { workoutDetailSheet, logPastWorkoutSheet } from '../sheets.jsx'

// The last seven days, today first, laid out like Plan's week: what you trained each day and
// which muscles it hit, so what is due next reads straight off it. A day without a workout is a
// rest day; tapping one logs a session you forgot (today: opens Start). Replaces Home's planned
// week for people who train by feel rather than by plan.

function MiniWorkoutMap({ workouts, body }) {
  const load = loadOfWorkouts(workouts)
  if (!Object.values(load).some(v => v > 0)) return null
  return <span className="bm-mini-wrap" aria-hidden="true"><BodyMap className="bm-mini" load={load} body={body} /></span>
}

export default function RecentDays({ S, days = 7 }) {
  const nav = useNavigate()
  const today = todayISO()
  const rows = []
  for (let i = 0; i < days; i++) {
    const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - i)
    const iso = isoOf(d)
    const isToday = iso === today
    const dayLabel = first => <span className={'plan-day-n' + (isToday ? ' today' : '')} aria-hidden="true">{first ? t(DAYS[d.getDay()]) : ''}</span>
    const tour = isToday ? 'today' : undefined
    const items = []
    // A session running now leads today's rows: one tap back into it.
    if (isToday && S.active) {
      items.push(<div key={iso + '-active'} className="item plan-day recent-day" data-tour={tour} aria-label={t('Today')} {...tappable(() => nav('/workout'))}>
        {dayLabel(true)}
        <span className="lrow-i" style={{ background: 'var(--orange)' }}><Icon name={S.active.editingWorkoutId ? 'pencil' : 'play'} /></span>
        <div className="grow"><div className="tt">{S.active.editingWorkoutId ? S.active.name : t('{0} (in progress)', S.active.name)}</div></div>
        <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{S.active.editingWorkoutId ? t('Edit') : t('Resume')}</span>
      </div>)
    }
    const done = S.workouts.filter(w => w.d === iso)
    done.forEach((w, n) => {
      const glyph = glyphOf((S.routines.find(r => r.id === w.routineId) || {}).emoji)
      items.push(<div key={w.id || iso + n} className="item plan-day recent-day" data-tour={!items.length ? tour : undefined}
        aria-label={t(DAYN[d.getDay()])} {...tappable(() => workoutDetailSheet(w))}>
        {dayLabel(!items.length)}
        <span className="lrow-i"><Icon name={glyph} /></span>
        <div className="grow">
          <div className="tt">{w.name || t('Workout done')}</div>
          <div className="ss">{[tn('{0} set', '{0} sets', setsDone(w)), ...durPart((w.end || 0) - (w.start || 0))].join(' · ')}</div>
        </div>
        <MiniWorkoutMap workouts={[w]} body={S.body} />
        <Icon name="chevronRight" className="chev" />
      </div>)
    })
    if (!items.length) {
      items.push(<div key={iso + '-rest'} className="item plan-day recent-day rest" data-tour={tour} aria-label={t(DAYN[d.getDay()])}
        {...tappable(() => (isToday ? nav('/workout') : logPastWorkoutSheet({ iso })))}>
        {dayLabel(true)}
        <span className="lrow-i rest"><Icon name="moon" /></span>
        <div className="grow"><div className="tt">{t('Rest')}</div></div>
        <Icon name="plus" className="chev" />
      </div>)
    }
    rows.push(...items)
  }
  return <div className="list plan-week recent-days">{rows}</div>
}
