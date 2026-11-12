// Runs one Claude review (lib/ai-review.js) through the AI Coach's own connection: the provider,
// model and API key the phone was set up with (Settings, AI Coach, Bring my own API key), the
// same data-sharing question before anything leaves (coach-api.js ensureAiConsent), the same
// daily cap and the same rule for which hosts may be called (coach-local.js guardedFetch).
// The answer is checked (checkReview) and saved in S.aiReviews[mode], so it syncs and backs up.
import { useStore } from '../store/useStore.js'
import { MOBILE } from './mobile.js'
import { ensureAiConsent } from './coach-api.js'
import { loadCoachDevice, saveCoachDevice, coachLimits } from './coach-device.js'
import { getApiKey } from './coach-secrets.js'
import { buildReviewPayload, buildReviewPrompt, checkReview, checkRunPlan, planToSave, schemaFor, REVIEW_MODES } from './ai-review.js'
import { getLang } from './i18n-core.js'
import { t } from './i18n.js'
import { todayISO } from './format.js'

const fail = (message, code = 'failed') => Object.assign(new Error(message), { code })

/** Whether this phone can ask: the Coach set up with its own key. */
export const aiReviewReady = () => MOBILE && useStore.getState().coachLocal?.mode === 'byok'

const langName = code => {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || 'English' } catch { return 'English' }
}

let running = null
export const aiReviewRunning = () => running

/** Asks for a review (`mode`: 'month' | 'stall') or a running plan ('runplan'), saves it and resolves with it. Throws with a readable message. */
export function runAiReview(mode, { deps = {} } = {}) {
  if (running) return running
  running = run(mode, deps).finally(() => { running = null })
  return running
}

async function run(mode, deps) {
  if (!REVIEW_MODES.includes(mode)) throw fail('unknown review')
  if (!(deps.ready || aiReviewReady)()) throw fail(t('Set up the AI Coach with your own API key first: Settings, AI Coach.'), 'off')
  await (deps.consent || ensureAiConsent)()
  const local = deps.local || await import('./coach-local.js')
  const core = deps.core || {
    ...(await import('../../../api/coach/core/providers.js')),
    ...(await import('../../../api/coach/core/parse.js')),
  }
  const d = await (deps.loadDevice || loadCoachDevice)()
  const adapter = local.ADAPTERS[d.provider]
  const meta = core.HTTP_PROVIDERS[d.provider]
  if (!adapter || !meta) throw fail(t('Set up the AI Coach with your own API key first: Settings, AI Coach.'), 'off')

  // The Coach's daily cap counts these too: they are paid for the same way.
  const today = todayISO()
  const used = d.daily && d.daily.d === today ? d.daily.n : 0
  const limit = coachLimits(d).daily
  if (limit > 0 && used >= limit) throw fail(t('The Coach is taking a breather. You’ve used today’s {0} runs on this phone.', limit), 'cap')
  await (deps.saveDevice || saveCoachDevice)({ daily: { d: today, n: used + 1 } })

  const S = useStore.getState().S
  const payload = buildReviewPayload(S, { mode })
  const { system, user } = buildReviewPrompt(payload, langName(getLang()))
  const key = await (deps.getKey || getApiKey)()
  const r = await adapter.invoke({
    cfg: { provider: d.provider, providerOptions: d.baseUrl ? { [d.provider]: { baseUrl: d.baseUrl } } : {} },
    prompt: user, system, schema: schemaFor(mode),
    model: d.model || meta.defaultModel, timeoutMs: local.timeoutFor(d.provider),
    env: key ? { [meta.apiKeyEnv]: key } : {}, fetch: local.guardedFetch, maxTokens: coachLimits(d).maxOutputTokens,
  })
  if (r.timedOut) throw fail(t('GymTrackAI did not answer in time. Try again in a moment.'))
  if (r.code !== 0) throw fail(t('GymTrackAI did not answer. Try again in a moment.') + (r.stderr ? ' (' + String(r.stderr).slice(0, 160) + ')' : ''))
  const parsed = core.extractJSON(r.text)
  // A running plan is saved as the plan (S.runPlan); a review beside the others (S.aiReviews).
  if (mode === 'runplan') {
    const checked = parsed.error ? { ok: false } : checkRunPlan(parsed.value)
    if (!checked.ok) throw fail(t('GymTrackAI did not answer. Try again in a moment.'))
    const plan = planToSave(useStore.getState().S, checked.plan)
    useStore.getState().update(s => { s.runPlan = plan })
    return plan
  }
  const checked = parsed.error ? { ok: false } : checkReview(parsed.value)
  if (!checked.ok) throw fail(t('GymTrackAI did not answer. Try again in a moment.'))
  const entry = { at: Date.now(), period: payload.period, review: checked.review, ...(mode === 'stall' ? { goals: payload.stalledGoals } : {}) }
  useStore.getState().update(s => { s.aiReviews = { ...(s.aiReviews || {}), [mode]: entry } })
  return entry
}
