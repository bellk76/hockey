export interface BestRow {
  date: string
  home: string
  away: string
  hs?: number
  as?: number
}

export interface MarketProbLookup {
  (home: string, away: string, date: string): { pHome?: number; pAway?: number } | null
}

export type Favourite = 'home' | 'away'

/**
 * «Суперматч по мнению рынка» за игровой день: матч с максимальной
 * де-виг вероятностью фаворита, но не ниже порога `minConfidence` (доля 0..1).
 * Согласие с моделью не требуется — это независимый выбор рынка.
 * Возвращает ключ «хозяева-гости» или null, если подходящих матчей нет.
 */
export function marketBestOfDay(
  rows: BestRow[],
  date: string,
  marketOf: MarketProbLookup,
  minConfidence: number,
): string | null {
  if (!Number.isFinite(minConfidence)) return null
  const min = Math.round(minConfidence * 100)
  let best: string | null = null
  let bestProb = -1
  for (const r of rows) {
    if (r.date !== date) continue
    const m = marketOf(r.home, r.away, r.date)
    if (!m || !Number.isFinite(m.pHome) || !Number.isFinite(m.pAway)) continue
    const p = Math.max(m.pHome as number, m.pAway as number)
    if (Math.round(p * 100) >= min && p > bestProb) {
      bestProb = p
      best = `${r.home}-${r.away}`
    }
  }
  return best
}

/**
 * Выборы рыночного суперматча по всем игровым дням списка (дата -> «хозяева-гости»).
 * Строки группируются по дате один раз — без повторного прохода по всему списку.
 */
export function marketPicksByDay(
  rows: BestRow[],
  marketOf: MarketProbLookup,
  minConfidence: number,
): Record<string, string> {
  const byDate = new Map<string, BestRow[]>()
  for (const r of rows) {
    const list = byDate.get(r.date)
    if (list) list.push(r)
    else byDate.set(r.date, [r])
  }
  const out: Record<string, string> = {}
  for (const [date, dayRows] of byDate) {
    const key = marketBestOfDay(dayRows, date, marketOf, minConfidence)
    if (key) out[date] = key
  }
  return out
}

export interface SuperTally {
  /** Сколько выбранных суперматчей уже сыграно. */
  played: number
  /** Сколько из них угадано (победил фаворит). */
  wins: number
  /** Сколько промахов. */
  losses: number
  /** Сколько суперматчей выбрано на ещё не сыгранные дни. */
  upcoming: number
}

/**
 * Сводка по сохранённым выборам суперматчей (дата -> «хозяева-гости»).
 * Прошедшие и будущие выборы передаются отдельно: в один день могут быть
 * и сыгранные, и ещё не начавшиеся матчи, и «лучший матч дня» для них разный.
 * `favOf` возвращает фаворита для сыгранного матча по тому же принципу,
 * по которому матч выбирался (модель или рынок).
 */
export function tallySuperMatches(
  playedRows: BestRow[],
  playedPicks: Record<string, string>,
  upcomingRows: BestRow[],
  upcomingPicks: Record<string, string>,
  favOf: (row: BestRow) => Favourite | null,
): SuperTally {
  const playedByKey = new Map<string, BestRow>()
  for (const r of playedRows) playedByKey.set(`${r.date}|${r.home}-${r.away}`, r)
  const upcomingKeys = new Set<string>()
  for (const r of upcomingRows) upcomingKeys.add(`${r.date}|${r.home}-${r.away}`)

  let played = 0
  let wins = 0
  let losses = 0
  let upcoming = 0
  for (const [date, key] of Object.entries(playedPicks)) {
    const row = playedByKey.get(`${date}|${key}`)
    if (!row || row.hs === undefined || row.as === undefined) continue
    // Равенство счёта в NHL не встречается, но не превращаем его в победу гостей.
    if (row.hs === row.as) continue
    const fav = favOf(row)
    if (!fav) continue
    played += 1
    const winner: Favourite = row.hs > row.as ? 'home' : 'away'
    if (fav === winner) wins += 1
    else losses += 1
  }
  for (const [date, key] of Object.entries(upcomingPicks)) {
    if (upcomingKeys.has(`${date}|${key}`)) upcoming += 1
  }
  return { played, wins, losses, upcoming }
}
