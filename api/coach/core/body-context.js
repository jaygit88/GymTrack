/* GymTrack: the food diary and the running, for the Coach (payload.js `ask` and `review`).
 *
 * The same allowlist rule as payload.js: every field is copied in by name and bounded. Pure,
 * and free of frontend imports (the server builds payloads too): the day totals are added up
 * here from the snapshot each logged food carries (`n`), the way frontend/src/lib/nutrition.js
 * does.
 *
 *   nutrition  { targets?, eatBackShare, days: [{ d, kcal, proteinG, carbsG, fatG, meals,
 *                exerciseKcal? }], average?, today? } for the logged days of the last four
 *                weeks; `today` lists what was eaten so far by meal, for "what should I have
 *                for dinner?". Null when nothing was ever logged.
 *   running    { goal?, runDays?, runs: [{ d, km, minutes, pace, hrAvg?, kcal? }] } for the
 *                last six weeks. Null without runs, a goal or run days.
 *
 * Food names are what the person typed or picked from a food list, never notes; they go only
 * with `today`, capped. */

const DAY = 86400e3;
export const NUTRITION_DAYS = 28;
export const RUN_DAYS = 42;
const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks', 'recovery'];
const NAME_MAX = 60;
const TODAY_MAX = 30;

const r1 = n => Math.round(n * 10) / 10;
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pad = n => String(n).padStart(2, '0');
const isoOf = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const entriesOn = (S, iso) => (Array.isArray(S?.foodLog?.[iso]) ? S.foodLog[iso] : []).filter(e => e && e.n && typeof e.n === 'object');

function dayOf(S, iso) {
  const list = entriesOn(S, iso);
  if (!list.length) return null;
  const sum = k => list.reduce((a, e) => a + num(e.n[k]), 0);
  const meals = {};
  for (const m of MEALS) {
    const k = list.filter(e => e.meal === m).reduce((a, e) => a + num(e.n.kcal), 0);
    if (k > 0) meals[m] = Math.round(k);
  }
  const extra = (Array.isArray(S?.exerciseLog?.[iso]) ? S.exerciseLog[iso] : []).reduce((a, x) => a + num(x?.kcal), 0)
    + (Array.isArray(S?.runs) ? S.runs : []).filter(r => r && r.d === iso).reduce((a, r) => a + num(r.kcal), 0);
  return { d: iso, kcal: Math.round(sum('kcal')), proteinG: r1(sum('protein')), carbsG: r1(sum('carbs')), fatG: r1(sum('fat')), meals,
    ...(extra > 0 ? { exerciseKcal: Math.round(extra) } : {}) };
}

export function nutritionOf(S, now = Date.now()) {
  if (!S?.foodLog || typeof S.foodLog !== 'object') return null;
  const days = [];
  for (let i = NUTRITION_DAYS - 1; i >= 0; i--) {
    const d = dayOf(S, isoOf(now - i * DAY));
    if (d) days.push(d);
  }
  if (!days.length) return null;
  const t = S.nutritionTargets;
  const share = [0, 0.25, 0.5, 0.75, 1].includes(t?.earnBack) ? t.earnBack : 0.5;
  const avg = k => r1(days.reduce((a, d) => a + d[k], 0) / days.length);
  const today = isoOf(now);
  const todayList = entriesOn(S, today).slice(0, TODAY_MAX);
  return {
    ...(num(t?.kcal) > 0 ? { targets: { kcal: Math.round(num(t.kcal)), ...(num(t.protein) > 0 ? { proteinG: Math.round(num(t.protein)) } : {}) } } : {}),
    eatBackShare: share,
    days,
    average: { days: days.length, kcal: Math.round(avg('kcal')), proteinG: avg('proteinG'), carbsG: avg('carbsG'), fatG: avg('fatG') },
    ...(todayList.length ? { today: Object.fromEntries(MEALS.map(m => [m, todayList.filter(e => e.meal === m)
      .map(e => ({ food: String(e.name || '').slice(0, NAME_MAX), kcal: Math.round(num(e.n.kcal)), proteinG: r1(num(e.n.protein)) }))]).filter(([, l]) => l.length)) } : {}),
  };
}

const KINDS = ['easy', 'long', 'tempo', 'intervals', 'recovery'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function runningOf(S, now = Date.now()) {
  const from = isoOf(now - RUN_DAYS * DAY);
  const runs = (Array.isArray(S?.runs) ? S.runs : [])
    .filter(r => r && typeof r.d === 'string' && r.d >= from && num(r.km) > 0)
    .slice(-60)
    .map(r => {
      const minutes = num(r.end) > num(r.start) ? Math.round((num(r.end) - num(r.start)) / 60000) : null;
      const pace = minutes && num(r.km) > 0 ? minutes / num(r.km) : null;
      return { d: r.d, km: r1(num(r.km)), ...(minutes ? { minutes } : {}),
        ...(pace ? { pace: Math.floor(pace) + ':' + pad(Math.round((pace % 1) * 60) % 60) + ' /km' } : {}),
        ...(num(r.hr?.avg) > 0 ? { hrAvg: Math.round(num(r.hr.avg)) } : {}),
        ...(num(r.kcal) > 0 ? { kcal: Math.round(num(r.kcal)) } : {}) };
    });
  const g = S?.runGoal;
  const goal = g && (g.kind === 'fitness' || g.kind === 'race')
    ? { kind: g.kind, ...(num(g.weeklyKm) > 0 ? { weeklyKm: num(g.weeklyKm) } : {}), ...(num(g.raceKm) > 0 ? { raceKm: num(g.raceKm) } : {}), ...(typeof g.by === 'string' ? { by: g.by.slice(0, 10) } : {}) }
    : null;
  const runDays = {};
  for (let wd = 0; wd < 7; wd++) {
    const list = (Array.isArray(S?.runWeek?.[wd]) ? S.runWeek[wd] : []).filter(p => p && KINDS.includes(p.kind));
    if (list.length) runDays[WD[wd]] = list.slice(0, 3).map(p => p.kind + (num(p.km) > 0 ? ' ' + r1(num(p.km)) + ' km' : ''));
  }
  const hasDays = Object.keys(runDays).length > 0;
  if (!runs.length && !goal && !hasDays) return null;
  return { ...(goal ? { goal } : {}), ...(hasDays ? { runDays } : {}), runs };
}
