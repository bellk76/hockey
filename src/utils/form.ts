import type { Game } from '../types'

/** Сколько последних матчей показываем в «форме» команды. */
export const FORM_N = 3

/**
 * До `n` последних матчей команды строго до указанной даты.
 * `byTeam` — игры команды, отсортированные по убыванию даты.
 */
export function recentGames(
  byTeam: Map<string, Game[]>,
  team: string,
  date: string,
  n = FORM_N,
): Game[] {
  if (n <= 0) return []
  const list = byTeam.get(team)
  if (!list) return []
  const out: Game[] = []
  for (const g of list) {
    if (g.date >= date) continue
    if (out.length >= n) break
    out.push(g)
  }
  return out
}
