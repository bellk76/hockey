import { describe, expect, it } from 'vitest'
import { buildRatings, predictMatch, walkForward } from './model'
import type { Game, TeamInfo } from '../types'

const teams: TeamInfo[] = [
  { abbrev: 'STR', name: 'Strong' },
  { abbrev: 'WEA', name: 'Weak' },
]

function makeGames(): Game[] {
  const games: Game[] = []
  for (let i = 0; i < 20; i += 1) {
    const day = String((i % 20) + 1).padStart(2, '0')
    const date = `2024-10-${day}`
    games.push({ date, home: 'STR', away: 'WEA', hs: 5, as: 1, outcome: 'REG' })
    games.push({ date, home: 'WEA', away: 'STR', hs: 1, as: 5, outcome: 'REG' })
  }
  return games
}

describe('predictMatch', () => {
  it('сумма вероятностей исходов ≈ 1', () => {
    const ratings = buildRatings(makeGames(), teams)
    const p = predictMatch(ratings, 'STR', 'WEA', '2024-11-01')
    expect(p.pHome + p.pAway + p.pDraw).toBeCloseTo(1, 3)
  })

  it('сильная команда получает большую вероятность победы', () => {
    const ratings = buildRatings(makeGames(), teams)
    const p = predictMatch(ratings, 'STR', 'WEA', '2024-11-01')
    expect(p.pHomeFinal).toBeGreaterThan(p.pAwayFinal)
    expect(p.eloHome).toBeGreaterThan(0.5)
  })

  it('после серии побед рейтинг Elo сильной команды выше стартового', () => {
    const ratings = buildRatings(makeGames(), teams)
    expect(ratings.elo.STR).toBeGreaterThan(1500)
    expect(ratings.elo.WEA).toBeLessThan(1500)
  })
})

describe('walkForward', () => {
  it('после прогрева даёт конечные вероятности (без NaN)', () => {
    const rows = walkForward(makeGames(), teams)
    const warmed = rows.slice(2)
    expect(warmed.length).toBeGreaterThan(0)
    expect(warmed.every((r) => Number.isFinite(r.pHome) && Number.isFinite(r.pAway))).toBe(true)
  })
})
