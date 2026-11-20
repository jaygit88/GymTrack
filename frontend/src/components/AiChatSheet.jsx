import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { aiReviewReady, runAiChat } from '../lib/ai-review-run.js'
import { appendChat } from '../lib/coach.js'
import { isOn } from '../lib/modules.js'
import { EXIDX } from '../lib/exercises.js'
import { t } from '../lib/i18n.js'

// "Ask GymTrackAI": a short chat about what is on screen (lib/ai-chat.js decides what Claude
// reads for each screen). Opened from Nutrition, from an exercise's menu in a workout, and from
// Home. Each question and answer is also saved to the GymTrackAI chat (S.coach.chat, views/CoachChat.jsx).

const STARTERS = {
  nutrition: ['What should I have for dinner?', 'Am I eating enough protein today?', 'What is a good snack after training?'],
  exercise: ['How do I get the most out of this?', 'Where should I feel it?', 'Should I go heavier today?'],
  general: ['What should I train today?', 'How did my week go?', 'Am I recovering well enough?'],
}
// The starters, for the string check: t('What should I have for dinner?') t('Am I eating enough protein today?')
// t('What is a good snack after training?') t('How do I get the most out of this?') t('Where should I feel it?')
// t('Should I go heavier today?') t('What should I train today?') t('How did my week go?') t('Am I recovering well enough?')

/** An answer as paragraphs, with "- " lines as a list. */
function Answer({ text }) {
  const blocks = []
  for (const line of String(text).split('\n').map(l => l.trim()).filter(Boolean)) {
    const item = /^[-•*]\s+/.test(line) ? line.replace(/^[-•*]\s+/, '') : null
    const last = blocks[blocks.length - 1]
    if (item != null) { if (last?.list) last.list.push(item); else blocks.push({ list: [item] }) } else blocks.push({ p: line })
  }
  return <>{blocks.map((b, i) => (b.list ? <ul key={i}>{b.list.map((x, j) => <li key={j}>{x}</li>)}</ul> : <p key={i}>{b.p}</p>))}</>
}

function AiChat({ close, where }) {
  const ready = aiReviewReady()
  const [turns, setTurns] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const end = useRef(null)
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' }) }, [turns.length, busy])

  const screen = where?.screen || 'general'
  const about = screen === 'nutrition' ? t('About today’s food')
    : screen === 'exercise' ? t('About {0}', EXIDX[where.exId]?.n || where.name || t('this exercise'))
      : t('About your training')
  const lastAi = [...turns].reverse().find(x => x.role === 'ai')
  const chips = turns.length ? (lastAi?.followUps || []) : STARTERS[screen].map(s => t(s))

  const setUp = () => {
    const st = useStore.getState()
    if (!isOn(st.S, 'coach')) st.update(s => { s.modules = { ...(s.modules || {}), coach: true } })
    close()
    window.location.hash = '#/coach/setup'
  }
  const ask = async q => {
    const question = String(q || '').trim()
    if (!question || busy) return
    const history = turns
    setTurns([...history, { role: 'you', text: question }]); setText(''); setBusy(true); setError(null)
    try {
      const r = await runAiChat(where, history, question)
      setTurns(x => [...x, { role: 'ai', text: r.answer, followUps: r.followUps }])
      // The same conversation as the GymTrackAI screen: it is there to read back, and to go on with.
      useStore.getState().update(s => {
        appendChat(s, { role: 'user', kind: 'text', text: question })
        appendChat(s, { role: 'coach', kind: 'text', text: r.answer })
      })
    } catch (e) {
      if (e?.code !== 'declined') setError(e?.message || t('Try again'))
      setTurns(x => (x[x.length - 1]?.role === 'you' ? x.slice(0, -1) : x))
      setText(question)
    }
    setBusy(false)
  }

  return <>
    <h3>{t('Ask GymTrackAI')}</h3>
    <div className="small muted ai-chat-about">{about}</div>
    {!ready ? <>
      <p className="small">{t('GymTrackAI answers with Claude, using the AI Coach connection and your own API key.')}</p>
      <Button variant="primary" icon="sparkles" onClick={setUp}>{t('Set up the AI Coach')}</Button>
    </> : <>
      <div className="ai-chat">
        {turns.map((x, i) => <div key={i} className={'ai-msg ' + (x.role === 'ai' ? 'ai' : 'you')}>{x.role === 'ai' ? <Answer text={x.text} /> : x.text}</div>)}
        {busy && <div className="ai-msg ai muted">{t('GymTrackAI is thinking…')}</div>}
        <div ref={end} />
      </div>
      {error && <div className="small ai-err">{error}</div>}
      {!busy && chips.length > 0 && <div className="ai-chips">{chips.map(c => <button key={c} className="ai-chip" onClick={() => ask(c)}>{c}</button>)}</div>}
      <form className="ai-compose" onSubmit={e => { e.preventDefault(); ask(text) }}>
        <textarea rows={1} value={text} maxLength={600} placeholder={t('Ask anything')} aria-label={t('Ask anything')}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text) } }} />
        <button type="submit" className="iconbtn ai-send" disabled={busy || !text.trim()} aria-label={t('Send')}><Icon name="arrowUp" /></button>
      </form>
      <div className="small muted ai-chat-note">{t('Answers use what is on this screen and your data.')}{' '}
        <button className="linkbtn" onClick={() => { close(); window.location.hash = '#/coach' }}>{t('Open the full chat')}</button></div>
    </>}
  </>
}

/** Opens the chat for a screen: { screen: 'nutrition', iso } | { screen: 'exercise', exId } | { screen: 'general' }. */
export const aiChatSheet = where => useUI.getState().openSheet(close => <AiChat close={close} where={where || { screen: 'general' }} />)
