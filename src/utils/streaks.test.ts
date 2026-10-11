import { describe, expect, it } from 'vitest'
import type { Game } from '../types'
import { EXTREME_MIN, streakOf, streakPenalty } from './streaks'

function win(date: string, home: string, away: string): Game {
  return { date, home, away, hs: 3, as: 1, outcome: 'REG' }
}

function loss(date: string, home: string, away: string): Game {
  return { date, home, away, hs: 1, as: 3, outcome: 'REG' }
}

// Текущий сезон: с 1 сентября (для дат октября 2026 — с 2026-09-01).
// Рекорд: два прошлых сезона (2024-09-01 … 2026-09-01).
describe('streakOf', () => {
  it('считает текущую серию побед только по текущему сезону', () => {
    // Победы в прошлом сезоне не учитываются в текущей серии.
    const games = [
      win('2026-03-01', 'CAR', 'BOS'), // прошлый сезон — не в счёт
      win('2026-03-03', 'CAR', 'BOS'),
      win('2026-10-01', 'CAR', 'BOS'), // текущий сезон
      win('2026-10-03', 'CAR', 'BOS'),
      win('2026-10-05', 'CAR', 'BOS'),
    ]
    const s = streakOf(games, 'CAR', '2026-10-06')
    expect(s?.type).toBe('win')
    expect(s?.length).toBe(3) // не 5
  })

  it('считает текущую серию поражений', () => {
    const games = [
      win('2026-10-01', 'CAR', 'BOS'),
      loss('2026-10-03', 'CAR', 'BOS'),
      loss('2026-10-05', 'CAR', 'BOS'),
    ]
    const s = streakOf(games, 'CAR', '2026-10-06')
    expect(s?.type).toBe('loss')
    expect(s?.length).toBe(2)
  })

  it('не заглядывает в будущее', () => {
    const games = [
      win('2026-10-01', 'CAR', 'BOS'),
      win('2026-10-03', 'CAR', 'BOS'),
      loss('2026-10-10', 'CAR', 'BOS'), // будущее
    ]
    const s = streakOf(games, 'CAR', '2026-10-05')
    expect(s?.type).toBe('win')
    expect(s?.length).toBe(2)
  })

  it('матч в саму дату запроса не учитывается', () => {
    const games = [
      win('2026-10-01', 'CAR', 'BOS'),
      win('2026-10-03', 'CAR', 'BOS'),
      loss('2026-10-05', 'CAR', 'BOS'), // дата запроса — строго до неё
    ]
    const s = streakOf(games, 'CAR', '2026-10-05')
    expect(s?.type).toBe('win')
    expect(s?.length).toBe(2)
  })

  it('возвращает null, если в текущем сезоне матчей до даты нет', () => {
    // Матч есть только в прошлом сезоне — текущей серии нет.
    const games = [win('2026-03-05', 'CAR', 'BOS')]
    expect(streakOf(games, 'CAR', '2026-10-10')).toBeNull()
    expect(streakOf([], 'CAR', '2026-10-10')).toBeNull()
    expect(streakOf(games, 'XYZ', '2026-10-10')).toBeNull()
  })

  it('учитывает игры и дома, и в гостях', () => {
    const games = [
      win('2026-10-01', 'CAR', 'BOS'),
      { date: '2026-10-03', home: 'BOS', away: 'CAR', hs: 1, as: 3, outcome: 'REG' },
      win('2026-10-05', 'CAR', 'BOS'),
    ]
    const s = streakOf(games, 'CAR', '2026-10-06')
    expect(s?.type).toBe('win')
    expect(s?.length).toBe(3)
  })

  it('порядок входного массива не важен', () => {
    const games = [
      win('2026-10-05', 'CAR', 'BOS'),
      win('2026-10-01', 'CAR', 'BOS'),
      win('2026-10-03', 'CAR', 'BOS'),
    ]
    const s = streakOf(games, 'CAR', '2026-10-06')
    expect(s?.length).toBe(3)
  })

  it('рекорд считается по двум прошлым сезонам (2024-09-01 … 2026-09-01)', () => {
    // Серия из 5 побед в марте 2026 (прошлый сезон) попадает в рекорд.
    const games = [
      win('2026-03-01', 'CAR', 'BOS'),
      win('2026-03-03', 'CAR', 'BOS'),
      win('2026-03-05', 'CAR', 'BOS'),
      win('2026-03-07', 'CAR', 'BOS'),
      win('2026-03-09', 'CAR', 'BOS'),
      // текущий сезон — 2 победы
      win('2026-10-01', 'CAR', 'BOS'),
      win('2026-10-03', 'CAR', 'BOS'),
    ]
    const s = streakOf(games, 'CAR', '2026-10-05')
    expect(s?.maxWin).toBe(5) // рекорд из прошлого сезона
    expect(s?.length).toBe(2) // текущая серия только по текущему сезону
  })

  it('серия не склеивается через межсезонье', () => {
    // 3 поражения конца сезона 24-25 + 2 поражения начала 25-26:
    // без сброса было бы maxLoss=5, с сбросом — 3.
    const games = [
      loss('2025-03-28', 'CAR', 'BOS'),
      loss('2025-03-30', 'CAR', 'BOS'),
      loss('2025-04-01', 'CAR', 'BOS'),
      loss('2025-10-05', 'CAR', 'BOS'),
      loss('2025-10-07', 'CAR', 'BOS'),
      // текущий сезон (26-27)
      win('2026-10-01', 'CAR', 'BOS'),
    ]
    const s = streakOf(games, 'CAR', '2026-10-02')
    expect(s?.maxLoss).toBe(3) // не 5
    expect(s?.maxWin).toBe(0)
  })

  it('рекорд не учитывает данные старше двух сезонов', () => {
    // Серия в январе 2024 — до начала окна (2024-09-01), не попадает в рекорд.
    // Победа 2026-10-01 — в текущем сезоне, не в окне рекорда.
    const games = [
      win('2024-01-01', 'CAR', 'BOS'),
      win('2024-01-03', 'CAR', 'BOS'),
      win('2024-01-05', 'CAR', 'BOS'),
      win('2024-01-07', 'CAR', 'BOS'),
      win('2024-01-09', 'CAR', 'BOS'),
      win('2026-10-01', 'CAR', 'BOS'),
    ]
    const s = streakOf(games, 'CAR', '2026-10-02')
    expect(s?.maxWin).toBe(0) // нет побед в окне 2024-09-01 … 2026-09-01
    expect(s?.length).toBe(1) // текущая серия по текущему сезону
  })

  it('без данных за прошлые сезоны серия не экстремальна (рекорд 0)', () => {
    const games = [
      win('2026-10-01', 'CAR', 'BOS'),
      win('2026-10-03', 'CAR', 'BOS'),
      win('2026-10-05', 'CAR', 'BOS'),
      win('2026-10-07', 'CAR', 'BOS'),
      win('2026-10-09', 'CAR', 'BOS'),
    ]
    const s = streakOf(games, 'CAR', '2026-10-10')
    expect(s?.length).toBe(5)
    expect(s?.maxWin).toBe(0)
    expect(s?.isExtremeWin).toBe(false) // сравнивать не с чем
  })

  it('isExtremeWin срабатывает при >= 75% от рекорда и длине >= 4', () => {
    // Рекорд 5 (прошлый сезон), текущая серия 4 — 4 >= 5*0.75=3.75, 4 >= 4.
    const games = [
      win('2026-03-01', 'CAR', 'BOS'),
      win('2026-03-03', 'CAR', 'BOS'),
      win('2026-03-05', 'CAR', 'BOS'),
      win('2026-03-07', 'CAR', 'BOS'),
      win('2026-03-09', 'CAR', 'BOS'),
      win('2026-10-01', 'CAR', 'BOS'),
      win('2026-10-03', 'CAR', 'BOS'),
      win('2026-10-05', 'CAR', 'BOS'),
      win('2026-10-07', 'CAR', 'BOS'),
    ]
    const s = streakOf(games, 'CAR', '2026-10-08')
    expect(s?.length).toBe(4)
    expect(s?.maxWin).toBe(5)
    expect(s?.isExtremeWin).toBe(true)
  })

  it(`не считает экстремальной серию короче EXTREME_MIN`, () => {
    // Рекорд 4 (прошлый сезон), серия 3 — 3 >= 4*0.75=3, но 3 < EXTREME_MIN.
    const games = [
      win('2026-03-01', 'CAR', 'BOS'),
      win('2026-03-03', 'CAR', 'BOS'),
      win('2026-03-05', 'CAR', 'BOS'),
      win('2026-03-07', 'CAR', 'BOS'),
      win('2026-10-01', 'CAR', 'BOS'),
      win('2026-10-03', 'CAR', 'BOS'),
      win('2026-10-05', 'CAR', 'BOS'),
    ]
    const s = streakOf(games, 'CAR', '2026-10-06')
    expect(s?.length).toBe(3)
    expect(s?.length).toBeLessThan(EXTREME_MIN)
    expect(s?.isExtremeWin).toBe(false)
  })

  it('isExtremeLoss срабатывает на длинной серии поражений', () => {
    // Рекорд 5 поражений (прошлый сезон), текущая серия 5.
    const games = [
      loss('2026-03-01', 'CAR', 'BOS'),
      loss('2026-03-03', 'CAR', 'BOS'),
      loss('2026-03-05', 'CAR', 'BOS'),
      loss('2026-03-07', 'CAR', 'BOS'),
      loss('2026-03-09', 'CAR', 'BOS'),
      loss('2026-10-01', 'CAR', 'BOS'),
      loss('2026-10-03', 'CAR', 'BOS'),
      loss('2026-10-05', 'CAR', 'BOS'),
      loss('2026-10-07', 'CAR', 'BOS'),
      loss('2026-10-09', 'CAR', 'BOS'),
    ]
    const s = streakOf(games, 'CAR', '2026-10-10')
    expect(s?.length).toBe(5)
    expect(s?.maxLoss).toBe(5)
    expect(s?.isExtremeLoss).toBe(true)
    expect(s?.isExtremeWin).toBe(false)
  })

  it('серия из 1 матча не экстремальна', () => {
    const games = [
      loss('2026-03-01', 'CAR', 'BOS'),
      loss('2026-03-03', 'CAR', 'BOS'),
      win('2026-10-01', 'CAR', 'BOS'),
      loss('2026-10-03', 'CAR', 'BOS'),
    ]
    const s = streakOf(games, 'CAR', '2026-10-04')
    expect(s?.type).toBe('loss')
    expect(s?.length).toBe(1)
    expect(s?.isExtremeLoss).toBe(false)
    expect(s?.isExtremeWin).toBe(false)
  })
})

describe('streakPenalty', () => {
  const streak = (over: Partial<Parameters<typeof streakPenalty>[0]>) =>
    ({
      type: 'win',
      length: 4,
      maxWin: 5,
      maxLoss: 5,
      isExtremeWin: false,
      isExtremeLoss: false,
      ...over,
    }) as NonNullable<Parameters<typeof streakPenalty>[0]>

  it('без экстремальных серий — множитель 1', () => {
    expect(streakPenalty(null, null)).toBe(1)
    expect(streakPenalty(streak({}), streak({ type: 'loss' }))).toBe(1)
  })

  it('фаворит на экстремальной победной серии — минус 3%', () => {
    expect(streakPenalty(streak({ isExtremeWin: true }), null)).toBeCloseTo(0.97, 5)
  })

  it('аутсайдер на экстремальной проигрышной — фавориту минус 3%', () => {
    expect(streakPenalty(null, streak({ type: 'loss', isExtremeLoss: true }))).toBeCloseTo(0.97, 5)
  })

  it('оба условия — минус 6% (не больше)', () => {
    const both = streakPenalty(
      streak({ isExtremeWin: true }),
      streak({ type: 'loss', isExtremeLoss: true }),
    )
    expect(both).toBeCloseTo(0.94, 5)
    expect(both).toBeGreaterThanOrEqual(0.94)
  })
})
