import { describe, it, expect } from 'vitest'
import { chatContext, buildChatPrompt, checkChat, CHAT_SCHEMA, chatHistoryOf } from './ai-chat.js'

const now = new Date('2026-11-18T18:00:00').getTime()
const S = {
  unit: 'kg', birthYear: 1988, sex: 'male', bodyweight: [{ d: '2026-11-17', w: 82 }],
  nutritionTargets: { kcal: 2950, protein: 150 },
  recipes: [{ id: 'r1', name: 'Recovery smoothie', servings: 1, items: [{ name: 'Oats', grams: 50, per100: { kcal: 380, protein: 12 } }] }],
  foodLog: { '2026-11-18': [
    { id: 'a', meal: 'breakfast', name: 'Porridge', src: 'cofid', ref: 'cofid:1', grams: 300, n: { kcal: 600, protein: 20, carbs: 90, fat: 12 }, at: 1 },
    { id: 'b', meal: 'lunch', name: 'Chicken wrap', src: 'custom', ref: 'c1', grams: 250, n: { kcal: 700, protein: 45, carbs: 60, fat: 20 }, at: 2 },
  ] },
  workouts: [
    { id: 'w1', d: '2026-11-18', name: 'Push', start: 1, end: 1 + 3600e3, entries: [{ id: '0025', sets: [{ w: 80, r: 8, done: true }, { w: 80, r: 7, done: true }] }] },
    { id: 'w0', d: '2026-11-11', name: 'Push', entries: [{ id: '0025', sets: [{ w: 77.5, r: 8, done: true }] }] },
  ],
  active: { name: 'Push', entries: [{ id: '0025', sets: [{ w: 82.5, r: 6, done: true }, { w: 82.5, r: 6, done: false }] }] },
}

describe('chatContext', () => {
  it('nutrition: the day by meal, what is left of the targets and the recipes', () => {
    const c = chatContext(S, { screen: 'nutrition', iso: '2026-11-18', now })
    expect(c.screen).toBe('nutrition')
    expect(c.you).toMatchObject({ age: 38, sex: 'male', weight: '82 kg' })
    expect(c.nutrition.eaten.kcal).toBe(1300)
    expect(c.nutrition.left).toEqual({ kcal: 1650, proteinG: 85 })
    expect(Object.keys(c.nutrition.meals)).toEqual(['breakfast', 'lunch'])
    expect(c.nutrition.recipes[0]).toMatch(/^Recovery smoothie \(190 kcal, 6 g protein a serving\)$/)
    expect(c.nutrition.foodsYouEat).toEqual(['Chicken wrap', 'Porridge'])
    expect(c.nutrition.trainedToday).toEqual(['Push'])
  })
  it('exercise: muscles, today\'s sets and the last sessions, newest first', () => {
    const c = chatContext(S, { screen: 'exercise', exId: '0025', now })
    expect(c.exercise).toMatchObject({ name: 'barbell bench press', target: 'pectorals' })
    expect(c.exercise.today).toEqual({ done: ['82.5 kg x 6'], toDo: ['82.5 kg x 6'] })
    expect(c.exercise.lastSessions).toEqual([{ date: '2026-11-18', sets: ['80 kg x 8', '80 kg x 7'] }, { date: '2026-11-11', sets: ['77.5 kg x 8'] }])
  })
  it('general, and any unknown screen, read the last two weeks', () => {
    const c = chatContext(S, { screen: 'nope', now })
    expect(c.screen).toBe('general')
    expect(c.recent.last14Days.map(w => w.date)).toEqual(['2026-11-18', '2026-11-11'])
    expect(c.recent.inWorkoutNow.exercises).toEqual(['barbell bench press'])
  })
  it('copes with an empty profile', () => {
    expect(chatContext({}, { screen: 'nutrition', now }).nutrition.eaten.kcal).toBe(0)
    expect(chatContext({}, { screen: 'exercise', exId: 'x', now }).exercise.lastSessions).toEqual([])
  })
})

describe('buildChatPrompt', () => {
  it('sends the context, the last turns and the question', () => {
    const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'ai' : 'you', text: 't' + i }))
    const { system, user } = buildChatPrompt({ unit: 'kg' }, history, '  What for dinner?  ', 'English')
    const u = JSON.parse(user)
    expect(u.question).toBe('What for dinner?')
    expect(u.earlierInThisChat).toHaveLength(8)
    expect(u.earlierInThisChat[0]).toEqual({ you: 't4' })
    expect(system).toContain('Write in English')
    expect(CHAT_SCHEMA.required).toEqual(['answer', 'followUps'])
  })
})

describe('checkChat', () => {
  it('keeps plain text and up to three follow-ups', () => {
    expect(checkChat({ answer: ' **Salmon** and rice — about 700 kcal ', followUps: ['a', ' ', 'b', 'c', 'd'] }))
      .toEqual({ ok: true, answer: 'Salmon and rice ,  about 700 kcal'.replace(' ,  ', ', '), followUps: ['a', 'b', 'c'] })
  })
  it('refuses an empty answer', () => {
    expect(checkChat({ answer: '' }).ok).toBe(false)
    expect(checkChat(null).ok).toBe(false)
  })
})

describe('chatHistoryOf', () => {
  it('keeps the plain lines of the saved chat, the last few, as you and ai', () => {
    const chat = [{ role: 'user', kind: 'intake' }, { role: 'user', kind: 'text', text: 'a' }, { role: 'coach', kind: 'applied', text: 'x' }, { role: 'coach', kind: 'text', text: 'b' }]
    expect(chatHistoryOf(chat)).toEqual([{ role: 'you', text: 'a' }, { role: 'ai', text: 'b' }])
    expect(chatHistoryOf(null)).toEqual([])
  })
})
