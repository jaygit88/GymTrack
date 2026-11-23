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
import { buildReviewPayload, buildReviewPrompt, checkReview, checkRunPlan, checkQuick, planToSave, schemaFor, REVIEW_MODES } from './ai-review.js'
import { chatContext, buildChatPrompt, checkChat, CHAT_SCHEMA } from './ai-chat.js'
import { buildLabelPrompt, checkLabel, LABEL_SCHEMA } from './label-read.js'
import { checkProposal } from './ai-plan.js'
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

/** Asks for a review (`mode`: 'month' | 'stall') or a running plan ('runplan'), saves it and resolves with it; a quick workout ('quick', for `minutes`) is only returned. Throws with a readable message. */
export function runAiReview(mode, { deps = {}, minutes = 30 } = {}) {
  if (running) return running
  running = run(mode, deps, { minutes }).finally(() => { running = null })
  return running
}

/**
 * One call to the model through the Coach's connection: ready, consent, the daily cap, then the
 * prompt `build(S)` makes ({ system, user, schema }). Resolves with the parsed JSON ({ error } or
 * { value }) and whatever `build` returned.
 */
async function callModel(deps, build) {
  if (!(deps.ready || aiReviewReady)()) throw fail(t('Set up GymTrackAI with your own API key first: Settings, GymTrackAI.'), 'off')
  await (deps.consent || ensureAiConsent)()
  const local = deps.local || await import('./coach-local.js')
  const core = deps.core || {
    ...(await import('../../../api/coach/core/providers.js')),
    ...(await import('../../../api/coach/core/parse.js')),
  }
  const d = await (deps.loadDevice || loadCoachDevice)()
  const adapter = local.ADAPTERS[d.provider]
  const meta = core.HTTP_PROVIDERS[d.provider]
  if (!adapter || !meta) throw fail(t('Set up GymTrackAI with your own API key first: Settings, GymTrackAI.'), 'off')

  const built = build(useStore.getState().S)
  // Only the Anthropic adapter carries a photo; another provider would answer without seeing it.
  if (built.images && d.provider !== 'anthropic') throw fail(t('Reading a label needs Claude (Anthropic) as the GymTrackAI provider.'), 'provider')

  // The Coach's daily cap counts these too: they are paid for the same way.
  const today = todayISO()
  const used = d.daily && d.daily.d === today ? d.daily.n : 0
  const limit = coachLimits(d).daily
  if (limit > 0 && used >= limit) throw fail(t('The Coach is taking a breather. You’ve used today’s {0} runs on this phone.', limit), 'cap')
  await (deps.saveDevice || saveCoachDevice)({ daily: { d: today, n: used + 1 } })

  const key = await (deps.getKey || getApiKey)()
  const r = await adapter.invoke({
    cfg: { provider: d.provider, providerOptions: d.baseUrl ? { [d.provider]: { baseUrl: d.baseUrl } } : {} },
    prompt: built.user, system: built.system, schema: built.schema, ...(built.images ? { images: built.images } : {}),
    model: d.model || meta.defaultModel, timeoutMs: local.timeoutFor(d.provider),
    env: key ? { [meta.apiKeyEnv]: key } : {}, fetch: local.guardedFetch, maxTokens: coachLimits(d).maxOutputTokens,
  })
  if (r.timedOut) throw fail(t('GymTrackAI did not answer in time. Try again in a moment.'))
  if (r.code !== 0) throw fail(t('GymTrackAI did not answer. Try again in a moment.') + (r.stderr ? ' (' + String(r.stderr).slice(0, 160) + ')' : ''))
  return { parsed: core.extractJSON(r.text), built }
}

async function run(mode, deps, opts = {}) {
  if (!REVIEW_MODES.includes(mode)) throw fail('unknown review')
  const { parsed, built: { payload } } = await callModel(deps, S => {
    const payload = buildReviewPayload(S, { mode, minutes: opts.minutes })
    return { ...buildReviewPrompt(payload, langName(getLang())), schema: schemaFor(mode), payload }
  })
  // A quick workout is for right now: handed back to the sheet, never saved.
  if (mode === 'quick') {
    const checked = parsed.error ? { ok: false } : checkQuick(parsed.value, payload.quick.library, payload.quick.minutes)
    if (!checked.ok) throw fail(t('GymTrackAI did not answer. Try again in a moment.'))
    return checked.plan
  }
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

/**
 * One question in an "Ask GymTrackAI" chat (lib/ai-chat.js): `where` is the screen
 * ({ screen, iso?, exId? }), `history` the chat so far. Resolves with { answer, followUps };
 * nothing is saved.
 */
export async function runAiChat(where, history, question, { deps = {} } = {}) {
  const { parsed } = await callModel(deps, S => ({
    ...buildChatPrompt(chatContext(S, where), history, question, langName(getLang())), schema: CHAT_SCHEMA,
  }))
  const checked = parsed.error ? { ok: false } : checkChat(parsed.value)
  if (!checked.ok) throw fail(t('GymTrackAI did not answer. Try again in a moment.'))
  // A plan change, checked against the plan as it is now: real exercises, a routine that exists.
  const plan = checked.proposal ? checkProposal(useStore.getState().S, checked.proposal, todayISO()) : null
  return { answer: checked.answer, followUps: checked.followUps, ...(plan?.ok ? { proposal: plan.proposal, ...(plan.dropped?.length ? { dropped: plan.dropped } : {}) } : {}) }
}

/**
 * Reads a nutrition label from a photo (`image`: { mediaType, data }, lib/label-read.js
 * photoForModel). Resolves with { name, per100, serving? } to check before saving; throws with a
 * readable message when the label cannot be read.
 */
export async function runLabelRead(image, { name = '', deps = {} } = {}) {
  const { parsed } = await callModel(deps, () => ({
    ...buildLabelPrompt({ name, langName: langName(getLang()) }), schema: LABEL_SCHEMA, images: [image],
  }))
  const checked = parsed.error ? { ok: false } : checkLabel(parsed.value)
  if (!checked.ok) throw fail(checked.problem ? t('GymTrackAI could not read the label: {0}', checked.problem) : t('GymTrackAI could not read the label. Try a sharper photo of just the nutrition table.'), 'unreadable')
  return { name: checked.name, per100: checked.per100, ...(checked.serving ? { serving: checked.serving } : {}) }
}
