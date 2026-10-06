export interface Game {
  date: string
  home: string
  away: string
  hs: number
  as: number
  outcome: string
}

export interface TeamInfo {
  abbrev: string
  name: string
}

export interface BacktestRow {
  date: string
  home: string
  away: string
  hs: number
  as: number
  outcome: string
  pHome: number
  pAway: number
  pOver: number
}

export interface OddsRecord {
  date: string
  home: string
  away: string
  pHome?: number
  pAway?: number
  oddsHome?: number
  oddsAway?: number
  odds1X?: number
  odds12?: number
  oddsX2?: number
  oddsOver?: number
  oddsUnder?: number
  pOverMarket?: number
  pUnderMarket?: number
  books?: number
}

export interface Ratings {
  teams: TeamInfo[]
  elo: Record<string, number>
  attack: Record<string, number>
  defense: Record<string, number>
  leagueAvg: number
  homeAdvantage: number
  games: number
  lastGameDates: Record<string, string[]>
  restFactor: { b2b: number; rest2: number; rested: number }
}

export interface Prediction {
  lambdaHome: number
  lambdaAway: number
  pHome: number
  pAway: number
  pDraw: number
  pHomeFinal: number
  pAwayFinal: number
  eloHome: number
  score: string
  expectedTotal: number
  pOver: number
  restHome: number
  restAway: number
  travel: number
}
