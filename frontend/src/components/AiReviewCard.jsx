import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CardHead from './CardHead.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { useStore } from '../store/useStore.js'
import { storedReview } from '../lib/ai-review.js'
import { aiReviewReady, runAiReview } from '../lib/ai-review-run.js'
import { fmtDate, isoOf } from '../lib/format.js'
import { isOn } from '../lib/modules.js'
import { t } from '../lib/i18n.js'
import { goalsSheet } from './MeasureChangeCard.jsx'

// GymTrack: Claude's monthly review on Home (lib/ai-review.js), and the same answer layout for
// the suggestions on the "no progress" card. Asked for with a tap, never on its own: each one is
// a paid request on your own key.

/** A review's text: the summary, what went well, and the suggestions. */
export function ReviewBody({ review, compact = false }) {
  return <div className="ai-review">
    <p className="ai-sum">{review.summary}</p>
    {!compact && review.highlights.length > 0 && <ul className="ai-hl">
      {review.highlights.map((h, i) => <li key={i}><Icon name="check" />{h}</li>)}
    </ul>}
    <div className="ai-sug-h lbl2">{t('Suggestions')}</div>
    <ol className="ai-sug">
      {review.suggestions.map((s, i) => <li key={i}><div className="ai-sug-t">{s.title}</div><div className="small muted">{s.why}</div></li>)}
    </ol>
  </div>
}

/** Ask for one review; `busy` and `error` for the button and the line under it. */
export function useAiReview(mode) {
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const ready = aiReviewReady()
  const ask = async () => {
    if (!ready) {
      // The Coach's setup screen is behind the AI Coach module: switch it on on the way there.
      const st = useStore.getState()
      if (!isOn(st.S, 'coach')) st.update(s => { s.modules = { ...(s.modules || {}), coach: true } })
      nav('/coach/setup')
      return
    }
    setBusy(true); setError(null)
    try { await runAiReview(mode) } catch (e) { if (e?.code !== 'declined') setError(e?.message || t('Try again')) }
    setBusy(false)
  }
  return { ready, busy, error, ask }
}

export default function AiReviewCard({ S }) {
  const saved = storedReview(S, 'month')
  const { ready, busy, error, ask } = useAiReview('month')
  return <div className="card ai-card">
    <CardHead icon="sparkles" tint="var(--indigo)" title={t('Your month with Claude')}
      sub={saved ? t('Reviewed {0}', fmtDate(isoOf(new Date(saved.at)), true)) : t('A summary of the last 30 days and ideas for next month.')} />
    {saved && <ReviewBody review={saved.review} />}
    {error && <div className="small ai-err">{error}</div>}
    <div className="ai-actions">
      <Button size="sm" variant={saved ? 'ghost' : 'tinted'} icon="sparkles" disabled={busy} onClick={ask}>
        {!ready ? t('Set up the AI Coach') : busy ? t('Claude is thinking…') : saved ? t('Review again') : t('Review my month')}
      </Button>
    </div>
  </div>
}

// How long Claude's suggestions for stalled goals stay on the card: a month, while the same goals
// are stuck. A new goal stalling, or one recovering, asks for fresh ones.
const STALL_FRESH_MS = 35 * 86400e3

/** The top-of-Home flag for goals that stopped improving, with Claude's suggestions for them. */
export function StallCard({ S, stalled }) {
  const nav = useNavigate()
  const names = stalled.map(r => t(r.label))
  const saved = storedReview(S, 'stall')
  const same = saved && Date.now() - saved.at < STALL_FRESH_MS &&
    JSON.stringify([...(saved.goals || [])].sort()) === JSON.stringify(stalled.map(r => r.label).sort())
  const { ready, busy, error, ask } = useAiReview('stall')
  return <div className="card tap-host mstall-card">
    <CardHead icon="warning" tint="var(--orange)" eyebrow={t('Measurement goals')} title={t('No progress in a month')}
      sub={names.join(', ')} open={{ onClick: () => nav('/measurements') }} />
    {same && <ReviewBody review={saved.review} compact />}
    {error && <div className="small ai-err">{error}</div>}
    <div className="ai-actions">
      <Button size="sm" variant="ghost" icon="target" onClick={goalsSheet}>{t('Goals')}</Button>
      <Button size="sm" variant={same ? 'ghost' : 'tinted'} icon="sparkles" disabled={busy} onClick={ask}>
        {!ready ? t('Set up the AI Coach') : busy ? t('Claude is thinking…') : same ? t('Ask again') : t('Ask Claude')}
      </Button>
    </div>
  </div>
}
