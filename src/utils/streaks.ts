import type { Game } from '../types'
import { seasonStartOf, seasonYearOf } from './season.ts'

/** Минимальная длина серии, чтобы считать её «экстремальной». */
export const EXTREME_MIN = 4
/** Порог: текущая серия >= этого процента от рекорда команды. */
const EXTREME_RATIO = 0.75

export interface StreakInfo {
  type: 'win' | 'loss'
  length: number
  maxWin: number
  maxLoss: number
  isExtremeWin: boolean
  isExtremeLoss: boolean
}

function didWin(g: Game, team: string): boolean {
  return g.home === team ? g.hs > g.as : g.as > g.hs
}

/** Начало двух сезонов до текущего (для рекордных серий). */
function recordWindowStart(date: string): string {
  return `${seasonYearOf(date) - 2}-09-01`
}

/**
 * Текущая серия команды — только по текущему сезону (строго до `date`).
 * Рекордные серии (maxWin/maxLoss) — по двум прошлым сезонам, серия не
 * продолжается через межсезонье (счётчик сбрасывается на границе сезонов).
 * Порядок входного массива не важен — копия сортируется по дате.
 * Возвращает null, если у команды нет матчей в текущем сезоне до `date`.
 */
export function streakOf(games: Game[], team: string, date: string): StreakInfo | null {
  const own = games
    .filter((g) => g.date < date && (g.home === team || g.away === team))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  if (own.length === 0) return null

  const curStart = seasonStartOf(date)
  const recStart = recordWindowStart(date)

  // Текущая серия — только матчи текущего сезона, с конца.
  const current = own.filter((g) => g.date >= curStart)
  if (current.length === 0) return null
  const lastWin = didWin(current[current.length - 1], team)
  let length = 1
  for (let i = current.length - 2; i >= 0; i--) {
    if (didWin(current[i], team) === lastWin) length++
    else break
  }

  // Рекордные серии — два прошлых сезона; на границе сезонов серия обрывается.
  const past = own.filter((g) => g.date >= recStart && g.date < curStart)
  let maxWin = 0
  let maxLoss = 0
  let cur = 0
  let curWin = true
  let lastSeason = ''
  for (const g of past) {
    const w = didWin(g, team)
    const season = seasonStartOf(g.date)
    if (cur === 0 || season !== lastSeason || w !== curWin) {
      curWin = w
      cur = 1
    } else {
      cur++
    }
    lastSeason = season
    if (w) maxWin = Math.max(maxWin, cur)
    else maxLoss = Math.max(maxLoss, cur)
  }

  // Рекорд 0 = данных за прошлые сезоны нет — сравнивать не с чем.
  const isExtremeWin =
    lastWin && length >= EXTREME_MIN && maxWin > 0 && length >= maxWin * EXTREME_RATIO
  const isExtremeLoss =
    !lastWin && length >= EXTREME_MIN && maxLoss > 0 && length >= maxLoss * EXTREME_RATIO

  return {
    type: lastWin ? 'win' : 'loss',
    length,
    maxWin,
    maxLoss,
    isExtremeWin,
    isExtremeLoss,
  }
}

export const STREAK_ADJUST = 0.03

/**
 * Корректировка вероятности фаворита для выбора суперматча (не для прогноза —
 * показанные вероятности она не меняет).
 * Фаворит на экстремальной победной серии — минус 3% (штраф).
 * Аутсайдер на экстремальной проигрышной серии — фавориту минус 3% (отскок).
 * Возвращает множитель для p фаворита (0.97…1 или 0.94 при обоих условиях).
 */
export function streakPenalty(favStreak: StreakInfo | null, underStreak: StreakInfo | null): number {
  let penalty = 0
  if (favStreak?.isExtremeWin) penalty += STREAK_ADJUST
  if (underStreak?.isExtremeLoss) penalty += STREAK_ADJUST
  return 1 - Math.min(penalty, 0.06)
}
