import { describe, expect, it } from 'vitest'
import {
  advancedKey,
  buildRatings,
  defaultModelConfig,
  predictMatch,
  walkForward,
  type AdvancedIndex,
} from './model'
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

  it('с priorGames=0 и полным покрытием xg5 не даёт NaN', () => {
    const games = makeGames()
    const rows = walkForward(
      games,
      teams,
      { ...defaultModelConfig, strengthSource: 'xg5', priorGames: 0 },
      invertedXgIndex(games),
    )
    const warmed = rows.slice(2)
    expect(warmed.length).toBeGreaterThan(0)
    expect(warmed.every((r) => Number.isFinite(r.pHome) && Number.isFinite(r.pAway))).toBe(true)
  })
})

// xG-против-голов: STR забивает больше (5:1), но уступает по xG (1 против 3).
function invertedXgIndex(games: Game[]): AdvancedIndex {
  const idx: AdvancedIndex = {}
  for (const g of games) {
    const xg: Record<string, number> = { STR: 1, WEA: 3 }
    idx[advancedKey(g.date, g.home, g.away)] = {
      h5g: g.hs,
      a5g: g.as,
      h5c: 0,
      a5c: 0,
      h5x: xg[g.home],
      a5x: xg[g.away],
      hxa: xg[g.home],
      axa: xg[g.away],
    }
  }
  return idx
}

describe('источник силы', () => {
  it('5v5-xG с достаточным покрытием используется (сила отражает xG, а не голы)', () => {
    const games = makeGames()
    const withAdv = buildRatings(games, teams, { ...defaultModelConfig, strengthSource: 'xg5' }, invertedXgIndex(games))
    // По xG у WEA преимущество, хотя по голам побеждает STR.
    expect(withAdv.attack.WEA).toBeGreaterThan(withAdv.attack.STR)
  })

  it('при низком покрытии 5v5-данных — откат на голы', () => {
    const games = makeGames()
    const partial = invertedXgIndex(games.slice(0, 8)) // < 50% матчей
    const ratings = buildRatings(games, teams, { ...defaultModelConfig, strengthSource: 'xg5' }, partial)
    expect(ratings.attack.STR).toBeGreaterThan(ratings.attack.WEA)
  })
})
