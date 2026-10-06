import type { BacktestRow, Game, Prediction, Ratings, TeamInfo } from '../types'

const ELO_START = 1500
const ELO_K = 8
const HOME_ADV_ELO = 40
const ELO_SEASON_REGRESSION = 0.75
const HALF_LIFE_DAYS = 180
const MAX_GOALS = 15

const TIMEZONE: Record<string, number> = {
  BOS: -5, BUF: -5, CAR: -5, CBJ: -5, DET: -5, FLA: -5, MTL: -5, NJD: -5, NYI: -5,
  NYR: -5, OTT: -5, PHI: -5, PIT: -5, TBL: -5, TOR: -5, WSH: -5,
  CHI: -6, DAL: -6, MIN: -6, NSH: -6, STL: -6, WPG: -6,
  COL: -7, EDM: -7, CGY: -7, UTA: -7, ARI: -7,
  ANA: -8, LAK: -8, SJS: -8, SEA: -8, VAN: -8, VGK: -8,
}

const FACTORIAL: number[] = [1]
for (let i = 1; i <= MAX_GOALS; i += 1) FACTORIAL[i] = FACTORIAL[i - 1] * i

export function poisson(k: number, lambda: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / FACTORIAL[k]
}

function seasonOf(date: string): number {
  const [year, month] = date.split('-').map(Number)
  return month >= 9 ? year : year - 1
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

function restBucket(days: number): 'b2b' | 'rest2' | 'rested' {
  if (days <= 1) return 'b2b'
  if (days === 2) return 'rest2'
  return 'rested'
}

interface Outcome {
  pHome: number
  pAway: number
  pDraw: number
  score: string
  expectedTotal: number
  pOver: number
}

function outcomeProbs(lambdaHome: number, lambdaAway: number): Outcome {
  let pHome = 0
  let pAway = 0
  let pDraw = 0
  let pOver = 0
  let best = { score: '0:0', prob: 0 }
  for (let i = 0; i <= MAX_GOALS; i += 1) {
    for (let j = 0; j <= MAX_GOALS; j += 1) {
      const p = poisson(i, lambdaHome) * poisson(j, lambdaAway)
      if (i > j) pHome += p
      else if (i < j) pAway += p
      else pDraw += p
      if (p > best.prob) best = { score: `${i}:${j}`, prob: p }
      if (i + j > 5.5) pOver += p
    }
  }
  const total = pHome + pAway + pDraw
  if (total > 0) {
    pHome /= total
    pAway /= total
    pDraw /= total
    pOver /= total
  }
  return { pHome, pAway, pDraw, score: best.score, expectedTotal: lambdaHome + lambdaAway, pOver }
}

export function buildRatings(games: Game[], teams: TeamInfo[]): Ratings {
  const elo: Record<string, number> = {}
  const lastGame: Record<string, string> = {}
  const lastGameDates: Record<string, string[]> = {}
  for (const t of teams) {
    elo[t.abbrev] = ELO_START
    lastGameDates[t.abbrev] = []
  }

  const sorted = [...games].sort((a, b) => (a.date < b.date ? -1 : 1))
  const lastDate = sorted.length ? sorted[sorted.length - 1].date : '2020-01-01'

  const goalsFor: Record<string, number> = {}
  const goalsAgainst: Record<string, number> = {}
  const weightSum: Record<string, number> = {}
  const bucketGoals = { b2b: 0, rest2: 0, rested: 0 }
  const bucketGames = { b2b: 0, rest2: 0, rested: 0 }
  let weightedGoals = 0
  let weightedTeamGames = 0
  let homeGoals = 0
  let homeGames = 0
  let awayGoals = 0
  let awayGames = 0

  let currentSeason = sorted.length ? seasonOf(sorted[0].date) : 0

  for (const g of sorted) {
    if (!(g.home in elo) || !(g.away in elo)) continue

    const season = seasonOf(g.date)
    if (season !== currentSeason) {
      for (const key of Object.keys(elo)) {
        elo[key] = ELO_START + (elo[key] - ELO_START) * ELO_SEASON_REGRESSION
      }
      currentSeason = season
    }

    const homeRated = elo[g.home] + HOME_ADV_ELO
    const expectedHome = 1 / (1 + 10 ** ((elo[g.away] - homeRated) / 400))
    const delta = ELO_K * ((g.hs > g.as ? 1 : 0) - expectedHome)
    elo[g.home] += delta
    elo[g.away] -= delta

    const weight = 0.5 ** (daysBetween(g.date, lastDate) / HALF_LIFE_DAYS)
    goalsFor[g.home] = (goalsFor[g.home] ?? 0) + g.hs * weight
    goalsAgainst[g.home] = (goalsAgainst[g.home] ?? 0) + g.as * weight
    goalsFor[g.away] = (goalsFor[g.away] ?? 0) + g.as * weight
    goalsAgainst[g.away] = (goalsAgainst[g.away] ?? 0) + g.hs * weight
    weightSum[g.home] = (weightSum[g.home] ?? 0) + weight
    weightSum[g.away] = (weightSum[g.away] ?? 0) + weight

    weightedGoals += (g.hs + g.as) * weight
    weightedTeamGames += 2 * weight
    homeGoals += g.hs * weight
    awayGoals += g.as * weight
    homeGames += weight
    awayGames += weight

    for (const [team, scored] of [[g.home, g.hs], [g.away, g.as]] as const) {
      const prev = lastGame[team]
      if (prev) {
        const bucket = restBucket(daysBetween(prev, g.date))
        bucketGoals[bucket] += scored * weight
        bucketGames[bucket] += weight
      }
      lastGame[team] = g.date
      lastGameDates[team].push(g.date)
    }
  }

  const leagueAvg = weightedTeamGames > 0 ? weightedGoals / weightedTeamGames : 3
  const attack: Record<string, number> = {}
  const defense: Record<string, number> = {}
  for (const t of teams) {
    const w = weightSum[t.abbrev]
    attack[t.abbrev] = w ? (goalsFor[t.abbrev] ?? 0) / w / leagueAvg : 1
    defense[t.abbrev] = w ? (goalsAgainst[t.abbrev] ?? 0) / w / leagueAvg : 1
  }

  const homeRatio = homeGames > 0 && awayGames > 0 ? homeGoals / homeGames / (awayGoals / awayGames) : 1
  const restFactor = {
    b2b: bucketGames.b2b ? bucketGoals.b2b / bucketGames.b2b / leagueAvg : 1,
    rest2: bucketGames.rest2 ? bucketGoals.rest2 / bucketGames.rest2 / leagueAvg : 1,
    rested: bucketGames.rested ? bucketGoals.rested / bucketGames.rested / leagueAvg : 1,
  }

  return {
    teams,
    elo,
    attack,
    defense,
    leagueAvg,
    homeAdvantage: Math.sqrt(homeRatio),
    games: sorted.length,
    lastGameDates,
    restFactor,
  }
}

function restDaysBefore(ratings: Ratings, team: string, date: string): number {
  const dates = ratings.lastGameDates[team] ?? []
  let best = -1
  for (const d of dates) {
    if (d < date && (best < 0 || d > dates[best])) best = dates.indexOf(d)
  }
  if (best < 0) return 3
  return Math.min(14, daysBetween(dates[best], date))
}

export function predictMatch(ratings: Ratings, home: string, away: string, date: string): Prediction {
  const { leagueAvg, attack, defense, homeAdvantage, restFactor } = ratings
  const restHome = restDaysBefore(ratings, home, date)
  const restAway = restDaysBefore(ratings, away, date)
  const homeRest = restFactor[restBucket(restHome)]
  const awayRest = restFactor[restBucket(restAway)]

  const tzDiff = Math.abs((TIMEZONE[home] ?? -5) - (TIMEZONE[away] ?? -5))
  const travelFactor = Math.max(0.9, 1 - 0.015 * tzDiff)

  const lambdaHome = Math.max(0.2, leagueAvg * attack[home] * defense[away] * homeAdvantage * homeRest)
  const lambdaAway = Math.max(
    0.2,
    (leagueAvg * attack[away] * defense[home] * awayRest * travelFactor) / homeAdvantage,
  )

  const o = outcomeProbs(lambdaHome, lambdaAway)
  const eloHome = 1 / (1 + 10 ** ((ratings.elo[away] - (ratings.elo[home] + HOME_ADV_ELO)) / 400))

  return {
    lambdaHome,
    lambdaAway,
    pHome: o.pHome,
    pAway: o.pAway,
    pDraw: o.pDraw,
    pHomeFinal: o.pHome + o.pDraw / 2,
    pAwayFinal: o.pAway + o.pDraw / 2,
    eloHome,
    score: o.score,
    expectedTotal: o.expectedTotal,
    pOver: o.pOver,
    restHome,
    restAway,
    travel: tzDiff,
  }
}

export function walkForward(games: Game[], teams: TeamInfo[]): BacktestRow[] {
  const elo: Record<string, number> = {}
  const gf: Record<string, number> = {}
  const ga: Record<string, number> = {}
  const cnt: Record<string, number> = {}
  for (const t of teams) {
    elo[t.abbrev] = ELO_START
    gf[t.abbrev] = 0
    ga[t.abbrev] = 0
    cnt[t.abbrev] = 0
  }
  const lastGameWalk: Record<string, string> = {}
  const bucketGoals = { b2b: 0, rest2: 0, rested: 0 }
  const bucketGames = { b2b: 0, rest2: 0, rested: 0 }

  let totalGoals = 0
  let totalTeamGames = 0
  let homeGoals = 0
  let homeGames = 0
  let awayGoals = 0
  let awayGames = 0
  let currentSeason = 0

  const sorted = [...games].sort((a, b) => (a.date < b.date ? -1 : 1))
  const rows: BacktestRow[] = []

  for (const g of sorted) {
    if (!(g.home in elo) || !(g.away in elo)) continue
    const season = seasonOf(g.date)
    if (currentSeason !== 0 && season !== currentSeason) {
      for (const key of Object.keys(elo)) elo[key] = ELO_START + (elo[key] - ELO_START) * ELO_SEASON_REGRESSION
    }
    currentSeason = season

    let pHome = Number.NaN
    let pAway = Number.NaN
    if (cnt[g.home] > 0 && cnt[g.away] > 0 && totalTeamGames > 0 && homeGames > 0 && awayGames > 0) {
      const leagueAvg = totalGoals / totalTeamGames
      const homeAdv = Math.sqrt(homeGoals / homeGames / (awayGoals / awayGames))
      const attackHome = gf[g.home] / cnt[g.home] / leagueAvg
      const defenseAway = ga[g.away] / cnt[g.away] / leagueAvg
      const attackAway = gf[g.away] / cnt[g.away] / leagueAvg
      const defenseHome = ga[g.home] / cnt[g.home] / leagueAvg
      const restHomeDays = lastGameWalk[g.home] ? Math.min(14, daysBetween(lastGameWalk[g.home], g.date)) : 3
      const restAwayDays = lastGameWalk[g.away] ? Math.min(14, daysBetween(lastGameWalk[g.away], g.date)) : 3
      const rf = {
        b2b: bucketGames.b2b ? bucketGoals.b2b / bucketGames.b2b / leagueAvg : 1,
        rest2: bucketGames.rest2 ? bucketGoals.rest2 / bucketGames.rest2 / leagueAvg : 1,
        rested: bucketGames.rested ? bucketGoals.rested / bucketGames.rested / leagueAvg : 1,
      }
      const tzDiff = Math.abs((TIMEZONE[g.home] ?? -5) - (TIMEZONE[g.away] ?? -5))
      const travel = Math.max(0.9, 1 - 0.015 * tzDiff)
      const lh = Math.max(0.2, leagueAvg * attackHome * defenseAway * homeAdv * rf[restBucket(restHomeDays)])
      const la = Math.max(
        0.2,
        (leagueAvg * attackAway * defenseHome * rf[restBucket(restAwayDays)] * travel) / homeAdv,
      )
      const o = outcomeProbs(lh, la)
      pHome = o.pHome + o.pDraw / 2
      pAway = o.pAway + o.pDraw / 2
    }

    rows.push({
      date: g.date,
      home: g.home,
      away: g.away,
      hs: g.hs,
      as: g.as,
      outcome: g.outcome,
      pHome,
      pAway,
    })

    const homeRated = elo[g.home] + HOME_ADV_ELO
    const expectedHome = 1 / (1 + 10 ** ((elo[g.away] - homeRated) / 400))
    const delta = ELO_K * ((g.hs > g.as ? 1 : 0) - expectedHome)
    elo[g.home] += delta
    elo[g.away] -= delta

    gf[g.home] += g.hs
    ga[g.home] += g.as
    gf[g.away] += g.as
    ga[g.away] += g.hs
    cnt[g.home] += 1
    cnt[g.away] += 1
    totalGoals += g.hs + g.as
    totalTeamGames += 2
    homeGoals += g.hs
    homeGames += 1
    awayGoals += g.as
    awayGames += 1

    for (const [team, scored] of [[g.home, g.hs], [g.away, g.as]] as const) {
      const prev = lastGameWalk[team]
      if (prev) {
        const bucket = restBucket(Math.min(14, daysBetween(prev, g.date)))
        bucketGoals[bucket] += scored
        bucketGames[bucket] += 1
      }
      lastGameWalk[team] = g.date
    }
  }

  return rows
}
