import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { streakInfo } from '../lib/streak.js'
import { StreakFlame, StreakMeta, StreakParty } from '../components/Streak.jsx'
import { todayISO } from '../lib/format.js'
import { t, tn, dateLocale } from '../lib/i18n.js'
import { calendarSheet, starterPlanSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import CardHead from '../components/CardHead.jsx'
import RecentDays from '../components/RecentDays.jsx'
import MeasureChangeCard from '../components/MeasureChangeCard.jsx'
import { weekTally } from '../lib/queue.js'
import { WeeklySetsHomeLine } from '../components/WeeklySets.jsx'
import { RecapHomeCard } from '../components/Recap.jsx'
import { useConnectionTrouble } from '../components/SyncBanner.jsx'
import { Button } from '../components/ui.jsx'
import { SeasonDeco } from '../components/Seasonal.jsx'
import { WrappedHomeCard } from '../components/WrappedEntry.jsx'
import RecoveryHint from '../components/RecoveryHint.jsx'
import { ChallengesCard } from '../components/Challenges.jsx'
import { isOn } from '../lib/modules.js'

// Home = what you did lately + a quick glance. Deep charts & history live in Stats.
// GymTrack: no planned week here. The streak card carries the last seven days (what you trained
// and which muscles), so what is due next reads straight off it, and the body weight card gives
// way to the body change map (what your measurements did over the last month).
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  // The banner switched off and the sync stuck: a dot on the gear (Settings → Show connection status).
  const trouble = useConnectionTrouble()
  const today = new Date()
  // The streak card's fraction: this calendar week's workouts over the weekdays with a plan, or,
  // in a coach week, the queue's sessions and your own days together (lib/queue.js weekTally).
  const tally = weekTally(S, todayISO())
  const { done: doneThisWeek, planned: plannedPerWeek } = tally
  // The streak with its best run and freezes (lib/streak.js), read back from the workouts.
  const todayKey = todayISO()
  const streak = useMemo(() => streakInfo(S, todayKey), [S.workouts, S.weekStart, todayKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // Settings → Modules (lib/modules.js): what a module switched off hides here.
  const on = id => isOn(S, id)

  return <div className="narrow">
    <div className="hdr">
      <SeasonDeco spot="header-bats" />
      <div><h1>{user ? t('Hi {0}', user.name) : 'GymTrack'}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button className="iconbtn" data-tour="settings-gear" onClick={() => nav('/settings')} aria-label={trouble ? t('Settings') + ', ' + t('Connection problem') : t('Settings')}><Icon name="gear" />{trouble && <span className="tab-dot" aria-hidden="true" />}</button>
    </div>

    {/* The streak opens its calendar from its text (CardHead open); the last seven days, the
        weekly-sets line and the party banner are buttons of their own inside it. */}
    {on('motivation') ? <div className="card tap-host streak-card">
      <SeasonDeco spot="home-streak" />
      {/* in season, a Santa hat on the flame (components/Seasonal.jsx) */}
      <CardHead className="streak-head" glyph={<span className="streak-flame-wrap"><StreakFlame lit={streak.current > 0} /><SeasonDeco spot="streak-flame" /></span>}
        title={t('{0} week streak', streak.current)} open={{ onClick: () => calendarSheet(), haspopup: 'dialog' }}
        sub={<>{doneThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {tn('{0} workout total', '{0} workouts total', S.workouts.length)}</>}
        action={<Icon name="calendar" className="chev" style={{ fontSize: 'var(--fs-title3)' }} />} />
      {(streak.best > 0 || streak.freezes > 0) && <div className="muted small card-head-indent streak-meta-line"><StreakMeta info={streak} /></div>}
      <RecentDays S={S} />
      <StreakParty S={S} info={streak} tally={tally} />
      {/* Settings → Look & Home → Weekly sets on Home (lib/muscle-targets.js): the muscle with
          the most room this week, one tap from the Stats card. */}
      {/* Straight to Stats → Lifts, where the card is, not to the top of Overview (P5 deep link). */}
      {S.homeMuscleSets === true && <WeeklySetsHomeLine S={S} onOpen={() => nav('/stats?section=lifts')} />}
    </div>
      // Motivation off: no streak, but the last seven days and the weekly sets line keep a card.
      : <div className="card wsets-solo">
        <CardHead icon="calendar" tint="var(--acc)" title={t('Last 7 days')} />
        <RecentDays S={S} />
        {S.homeMuscleSets === true && <WeeklySetsHomeLine S={S} onOpen={() => nav('/stats?section=lifts')} />}
      </div>}

    {/* What your body measurements did over the last month, on the body (lib/measure-change.js). */}
    {on('body') && <MeasureChangeCard S={S} />}

    {/* Monday: Your week; the 1st: Your month (lib/recap.js). Off in Settings → Look & Home. */}
    <RecapHomeCard S={S} />

    {/* Christmas (lib/seasonal.js): the advent calendar's card, 1 to 24 December, from the theme's chunk. */}
    <SeasonDeco spot="home-advent" />

    {/* December and January: the year in openGym is ready (lib/wrapped.js homeCardYear). */}
    {on('motivation') && <WrappedHomeCard S={S} />}

    {/* What has rested and what is still recovering, kindly (lib/recovery-hint.js). */}
    {on('health') && <RecoveryHint S={S} />}

    {/* This month's three challenges and how far you are (lib/challenges.js). */}
    <ChallengesCard S={S} />

    {!S.routines.length && !S.workouts.length && !S.active && (
      <div className="card">
        <CardHead icon="calendar" title={t('Welcome!')} sub={t('Set up your weekly routine to get going, or grab a ready-made starter plan.')} />
        <Button variant="primary" icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}
  </div>
}
