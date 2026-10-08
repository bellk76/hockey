import { describe, expect, it } from 'vitest'
import type { Game } from '../types'
import { FORM_N, recentGames } from './form'

function game(id: string, date: string): Game {
  return { id, date, home: 'CAR', away: 'BOS', hs: 1, as: 0, outcome: 'REG' }
}

// Строит индекс «команда -> игры по убыванию даты», как в App.
function byTeamOf(list: Game[]): Map<string, Game[]> {
  const map = new Map<string, Game[]>()
  for (const g of list) {
    for (const team of [g.home, g.away]) {
      const arr = map.get(team) ?? []
      arr.push(g)
      map.set(team, arr)
    }
  }
  for (const arr of map.values()) arr.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return map
}

const byTeam = byTeamOf([
  game('a', '2026-10-06'),
  game('b', '2026-10-04'),
  game('c', '2026-10-02'),
  game('d', '2026-10-01'),
  game('e', '2026-10-08'),
])

describe('recentGames', () => {
  it('возвращает до 3 последних матчей строго до даты', () => {
    expect(recentGames(byTeam, 'CAR', '2026-10-08').map((g) => g.id)).toEqual(['a', 'b', 'c'])
  })

  it('исключает матч в день игры и будущие', () => {
    expect(recentGames(byTeam, 'CAR', '2026-10-06').map((g) => g.id)).toEqual(['b', 'c', 'd'])
  })

  it('ограничивает результат параметром n', () => {
    expect(recentGames(byTeam, 'CAR', '2026-10-08', 2).map((g) => g.id)).toEqual(['a', 'b'])
  })

  it('при n <= 0 возвращает пусто', () => {
    expect(recentGames(byTeam, 'CAR', '2026-10-08', 0)).toEqual([])
    expect(recentGames(byTeam, 'CAR', '2026-10-08', -1)).toEqual([])
  })

  it('для неизвестной команды возвращает пусто', () => {
    expect(recentGames(byTeam, 'XYZ', '2026-10-08')).toEqual([])
  })

  it('по умолчанию берёт FORM_N матчей', () => {
    expect(FORM_N).toBe(3)
    expect(recentGames(byTeam, 'CAR', '2026-10-08')).toHaveLength(FORM_N)
  })
})
