import type { BacktestRow, Game, Prediction, Ratings, TeamInfo } from '../types'

export type StrengthSource = 'goals' | 'goals5' | 'corsi5' | 'xg5' | 'xgall'

export interface ModelConfig {
  eloStart: number
  eloK: number
  homeAdvElo: number
  eloSeasonRegression: number
  halfLifeDays: number
  travelCoef: number
  travelFloor: number
  /** Сила регуляризации attack/defense к среднему лиги (в «псевдоматчах», 0 = выкл). */
  priorGames: number
  /** Поправка Dixon-Coles на низкие счета (0 = выкл). */
  dixonColesRho: number
  /** Доля ничьей в основное время, отнесённая хозяевам при разводе в ОТ/буллитах. */
  otHomeShare: number
  /** Что использовать для силы команд: голы, 5v5-голы или 5v5-броски (Corsi). */
  strengthSource: StrengthSource
  /** Вес Elo в итоговом исходе (0 = только Пуассон, 1 = только Elo). */
  eloWeight: number
  /** Калибровка итогового исхода: сжатие к 0.5 (1 = без изменений, <1 = мягче). */
  probShrink: number
}

/** Агрегаты матча из play-by-play (src/data/advanced.json), индексируются по `${date}_${home}_${away}`. */
export interface AdvancedGame {
  h5g: number
  a5g: number
  h5c: number
  a5c: number
  h5x: number
  a5x: number
  hxa: number
  axa: number
}
export type AdvancedIndex = Record<string, AdvancedGame>

export function advancedKey(date: string, home: string, away: string): string {
  return `${date}_${home}_${away}`
}

// Продвинутый источник (5v5/xG) используем, только если 5v5-данные покрывают
// хотя бы половину матчей; иначе — надёжный откат на голы.
function resolveSource(games: Game[], advanced: AdvancedIndex | undefined, cfg: ModelConfig): StrengthSource {
  if (cfg.strengthSource === 'goals' || !advanced) return 'goals'
  const covered = games.reduce((n, g) => n + (advanced[advancedKey(g.date, g.home, g.away)] ? 1 : 0), 0)
  return covered >= Math.max(1, games.length * 0.5) ? cfg.strengthSource : 'goals'
}

function shrinkProb(p: number, s: number): number {
  return Math.min(1, Math.max(0, 0.5 + s * (p - 0.5)))
}

export const defaultModelConfig: ModelConfig = {
  eloStart: 1500,
  eloK: 8,
  homeAdvElo: 40,
  eloSeasonRegression: 0.75,
  // Подобрано тюнингом (scripts/tune.mjs). Для xG лучше короткая память (~2–3 месяца).
  halfLifeDays: 90,
  travelCoef: 0.015,
  travelFloor: 0.9,
  priorGames: 2,
  dixonColesRho: 0,
  otHomeShare: 0.5,
  // Подобрано тюнингом: сила по 5v5-xG (координаты броска) даёт лучший Brier/log-loss.
  strengthSource: 'xg5',
  // Elo подмешивается к итоговому исходу (небольшой, но устойчивый плюс; помогает на старте).
  eloWeight: 0.2,
  probShrink: 1,
}

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

function outcomeProbs(lambdaHome: number, lambdaAway: number, rho = 0): Outcome {
  const ph: number[] = []
  const pa: number[] = []
  for (let k = 0; k <= MAX_GOALS; k += 1) {
    ph[k] = poisson(k, lambdaHome)
    pa[k] = poisson(k, lambdaAway)
  }

  let pHome = 0
  let pAway = 0
  let pDraw = 0
  let pOver = 0
  let best = { score: '0:0', prob: 0 }
  for (let i = 0; i <= MAX_GOALS; i += 1) {
    for (let j = 0; j <= MAX_GOALS; j += 1) {
      let p = ph[i] * pa[j]
      if (rho !== 0) {
        // Поправка Dixon-Coles на низкие счета.
        if (i === 0 && j === 0) p *= 1 - lambdaHome * lambdaAway * rho
        else if (i === 0 && j === 1) p *= 1 + lambdaHome * rho
        else if (i === 1 && j === 0) p *= 1 + lambdaAway * rho
        else if (i === 1 && j === 1) p *= 1 - rho
      }
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

export function buildRatings(
  games: Game[],
  teams: TeamInfo[],
  cfg: ModelConfig = defaultModelConfig,
  advanced?: AdvancedIndex,
): Ratings {
  // Если продвинутых данных мало (нет покрытия матчей) — считаем силу по голам (откат).
  const source = resolveSource(games, advanced, cfg)
  const elo: Record<string, number> = {}
  const lastGame: Record<string, string> = {}
  const lastGameDates: Record<string, string[]> = {}
  for (const t of teams) {
    elo[t.abbrev] = cfg.eloStart
    lastGameDates[t.abbrev] = []
  }

  const sorted = [...games].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const lastDate = sorted.length ? sorted[sorted.length - 1].date : '2020-01-01'

  const metricFor: Record<string, number> = {}
  const metricAgainst: Record<string, number> = {}
  const metricWeightSum: Record<string, number> = {}
  let totalMetric = 0
  let totalMetricWeight = 0
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
        elo[key] = cfg.eloStart + (elo[key] - cfg.eloStart) * cfg.eloSeasonRegression
      }
      currentSeason = season
    }

    const homeRated = elo[g.home] + cfg.homeAdvElo
    const expectedHome = 1 / (1 + 10 ** ((elo[g.away] - homeRated) / 400))
    const delta = cfg.eloK * ((g.hs > g.as ? 1 : 0) - expectedHome)
    elo[g.home] += delta
    elo[g.away] -= delta

    const weight = 0.5 ** (daysBetween(g.date, lastDate) / cfg.halfLifeDays)

    const adv = source !== 'goals' ? advanced?.[advancedKey(g.date, g.home, g.away)] : undefined
    let hasMetric = source === 'goals'
    let mh = g.hs
    let ma = g.as
    if (adv) {
      hasMetric = true
      if (source === 'goals5') {
        mh = adv.h5g
        ma = adv.a5g
      } else if (source === 'xg5') {
        mh = adv.h5x
        ma = adv.a5x
      } else if (source === 'xgall') {
        mh = adv.hxa
        ma = adv.axa
      } else {
        mh = adv.h5c
        ma = adv.a5c
      }
    }
    if (hasMetric) {
      metricFor[g.home] = (metricFor[g.home] ?? 0) + mh * weight
      metricAgainst[g.home] = (metricAgainst[g.home] ?? 0) + ma * weight
      metricFor[g.away] = (metricFor[g.away] ?? 0) + ma * weight
      metricAgainst[g.away] = (metricAgainst[g.away] ?? 0) + mh * weight
      metricWeightSum[g.home] = (metricWeightSum[g.home] ?? 0) + weight
      metricWeightSum[g.away] = (metricWeightSum[g.away] ?? 0) + weight
      totalMetric += (mh + ma) * weight
      totalMetricWeight += 2 * weight
    }

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
  const metricMean = totalMetricWeight > 0 ? totalMetric / totalMetricWeight : leagueAvg
  const attack: Record<string, number> = {}
  const defense: Record<string, number> = {}
  const prior = cfg.priorGames
  for (const t of teams) {
    const w = (metricWeightSum[t.abbrev] ?? 0) + prior
    attack[t.abbrev] = w
      ? ((metricFor[t.abbrev] ?? 0) + prior * metricMean) / w / metricMean
      : 1
    defense[t.abbrev] = w
      ? ((metricAgainst[t.abbrev] ?? 0) + prior * metricMean) / w / metricMean
      : 1
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
  let bestDate: string | null = null
  for (const d of dates) {
    if (d < date && (bestDate === null || d > bestDate)) bestDate = d
  }
  if (bestDate === null) return 3
  return Math.min(14, daysBetween(bestDate, date))
}

export function predictMatch(
  ratings: Ratings,
  home: string,
  away: string,
  date: string,
  cfg: ModelConfig = defaultModelConfig,
): Prediction {
  const { leagueAvg, attack, defense, homeAdvantage, restFactor } = ratings
  const restHome = restDaysBefore(ratings, home, date)
  const restAway = restDaysBefore(ratings, away, date)
  const homeRest = restFactor[restBucket(restHome)]
  const awayRest = restFactor[restBucket(restAway)]

  const tzDiff = Math.abs((TIMEZONE[home] ?? -5) - (TIMEZONE[away] ?? -5))
  const travelFactor = Math.max(cfg.travelFloor, 1 - cfg.travelCoef * tzDiff)

  const attackHome = attack[home] ?? 1
  const defenseHome = defense[home] ?? 1
  const attackAway = attack[away] ?? 1
  const defenseAway = defense[away] ?? 1

  const lambdaHome = Math.max(0.2, leagueAvg * attackHome * defenseAway * homeAdvantage * homeRest)
  const lambdaAway = Math.max(
    0.2,
    (leagueAvg * attackAway * defenseHome * awayRest * travelFactor) / homeAdvantage,
  )

  const o = outcomeProbs(lambdaHome, lambdaAway, cfg.dixonColesRho)
  const eloHomeRating = ratings.elo[home] ?? cfg.eloStart
  const eloAwayRating = ratings.elo[away] ?? cfg.eloStart
  const eloHome = 1 / (1 + 10 ** ((eloAwayRating - (eloHomeRating + cfg.homeAdvElo)) / 400))

  const pPoissonHome = o.pHome + o.pDraw * cfg.otHomeShare
  const pPoissonAway = o.pAway + o.pDraw * (1 - cfg.otHomeShare)
  const rawHome = (1 - cfg.eloWeight) * pPoissonHome + cfg.eloWeight * eloHome
  const rawAway = (1 - cfg.eloWeight) * pPoissonAway + cfg.eloWeight * (1 - eloHome)
  const pHomeFinal = shrinkProb(rawHome, cfg.probShrink)
  const pAwayFinal = shrinkProb(rawAway, cfg.probShrink)

  return {
    lambdaHome,
    lambdaAway,
    pHome: o.pHome,
    pAway: o.pAway,
    pDraw: o.pDraw,
    pHomeFinal,
    pAwayFinal,
    eloHome,
    score: o.score,
    expectedTotal: o.expectedTotal,
    pOver: o.pOver,
    restHome,
    restAway,
    travel: tzDiff,
  }
}

export function walkForward(
  games: Game[],
  teams: TeamInfo[],
  cfg: ModelConfig = defaultModelConfig,
  advanced?: AdvancedIndex,
): BacktestRow[] {
  const source = resolveSource(games, advanced, cfg)
  const elo: Record<string, number> = {}
  const wsum: Record<string, number> = {}
  const mf: Record<string, number> = {}
  const ma: Record<string, number> = {}
  const mwsum: Record<string, number> = {}
  for (const t of teams) {
    elo[t.abbrev] = cfg.eloStart
    wsum[t.abbrev] = 0
    mf[t.abbrev] = 0
    ma[t.abbrev] = 0
    mwsum[t.abbrev] = 0
  }
  const lastGameWalk: Record<string, string> = {}
  const bucketGoals = { b2b: 0, rest2: 0, rested: 0 }
  const bucketWeight = { b2b: 0, rest2: 0, rested: 0 }

  let totalMetricW = 0
  let totalMetricWeightW = 0
  let totalGoalsW = 0
  let totalTeamGamesW = 0
  let homeGoalsW = 0
  let homeGamesW = 0
  let awayGoalsW = 0
  let awayGamesW = 0
  let currentSeason = 0
  let asOf = ''

  const sorted = [...games].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const rows: BacktestRow[] = []
  const prior = cfg.priorGames

  // Затухание накопленных сумм к дате матча — та же весовая модель (полураспад),
  // что и в buildRatings, но с «точкой отсчёта» на каждый матч (честный walk-forward).
  const decayTo = (date: string) => {
    if (!asOf) {
      asOf = date
      return
    }
    const dd = daysBetween(asOf, date)
    if (dd <= 0) return
    const decay = 0.5 ** (dd / cfg.halfLifeDays)
    for (const key of Object.keys(mf)) {
      wsum[key] *= decay
      mf[key] *= decay
      ma[key] *= decay
      mwsum[key] *= decay
    }
    totalMetricW *= decay
    totalMetricWeightW *= decay
    totalGoalsW *= decay
    totalTeamGamesW *= decay
    homeGoalsW *= decay
    homeGamesW *= decay
    awayGoalsW *= decay
    awayGamesW *= decay
    bucketGoals.b2b *= decay
    bucketGoals.rest2 *= decay
    bucketGoals.rested *= decay
    bucketWeight.b2b *= decay
    bucketWeight.rest2 *= decay
    bucketWeight.rested *= decay
    asOf = date
  }

  for (const g of sorted) {
    if (!(g.home in elo) || !(g.away in elo)) continue
    const season = seasonOf(g.date)
    if (currentSeason !== 0 && season !== currentSeason) {
      for (const key of Object.keys(elo)) elo[key] = cfg.eloStart + (elo[key] - cfg.eloStart) * cfg.eloSeasonRegression
    }
    currentSeason = season

    decayTo(g.date)

    let pHome = Number.NaN
    let pAway = Number.NaN
    let pOver = Number.NaN
    if (
      wsum[g.home] > 0 &&
      wsum[g.away] > 0 &&
      mwsum[g.home] + prior > 0 &&
      mwsum[g.away] + prior > 0 &&
      totalTeamGamesW > 0 &&
      homeGamesW > 0 &&
      awayGamesW > 0
    ) {
      const leagueAvg = totalGoalsW / totalTeamGamesW
      const metricMean = totalMetricWeightW > 0 ? totalMetricW / totalMetricWeightW : leagueAvg
      const homeAdv = Math.sqrt(homeGoalsW / homeGamesW / (awayGoalsW / awayGamesW))
      const wHome = mwsum[g.home] + prior
      const wAway = mwsum[g.away] + prior
      const attackHome = ((mf[g.home] + prior * metricMean) / wHome) / metricMean
      const defenseAway = ((ma[g.away] + prior * metricMean) / wAway) / metricMean
      const attackAway = ((mf[g.away] + prior * metricMean) / wAway) / metricMean
      const defenseHome = ((ma[g.home] + prior * metricMean) / wHome) / metricMean
      const restHomeDays = lastGameWalk[g.home] ? Math.min(14, daysBetween(lastGameWalk[g.home], g.date)) : 3
      const restAwayDays = lastGameWalk[g.away] ? Math.min(14, daysBetween(lastGameWalk[g.away], g.date)) : 3
      const rf = {
        b2b: bucketWeight.b2b ? bucketGoals.b2b / bucketWeight.b2b / leagueAvg : 1,
        rest2: bucketWeight.rest2 ? bucketGoals.rest2 / bucketWeight.rest2 / leagueAvg : 1,
        rested: bucketWeight.rested ? bucketGoals.rested / bucketWeight.rested / leagueAvg : 1,
      }
      const tzDiff = Math.abs((TIMEZONE[g.home] ?? -5) - (TIMEZONE[g.away] ?? -5))
      const travel = Math.max(cfg.travelFloor, 1 - cfg.travelCoef * tzDiff)
      const lh = Math.max(0.2, leagueAvg * attackHome * defenseAway * homeAdv * rf[restBucket(restHomeDays)])
      const la = Math.max(
        0.2,
        (leagueAvg * attackAway * defenseHome * rf[restBucket(restAwayDays)] * travel) / homeAdv,
      )
      const o = outcomeProbs(lh, la, cfg.dixonColesRho)
      const eloHomeP = 1 / (1 + 10 ** ((elo[g.away] - (elo[g.home] + cfg.homeAdvElo)) / 400))
      const pPoissonHome = o.pHome + o.pDraw * cfg.otHomeShare
      const pPoissonAway = o.pAway + o.pDraw * (1 - cfg.otHomeShare)
      const rawHome = (1 - cfg.eloWeight) * pPoissonHome + cfg.eloWeight * eloHomeP
      const rawAway = (1 - cfg.eloWeight) * pPoissonAway + cfg.eloWeight * (1 - eloHomeP)
      pHome = shrinkProb(rawHome, cfg.probShrink)
      pAway = shrinkProb(rawAway, cfg.probShrink)
      pOver = o.pOver
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
      pOver,
    })

    const homeRated = elo[g.home] + cfg.homeAdvElo
    const expectedHome = 1 / (1 + 10 ** ((elo[g.away] - homeRated) / 400))
    const delta = cfg.eloK * ((g.hs > g.as ? 1 : 0) - expectedHome)
    elo[g.home] += delta
    elo[g.away] -= delta

    wsum[g.home] += 1
    wsum[g.away] += 1

    const adv = source !== 'goals' ? advanced?.[advancedKey(g.date, g.home, g.away)] : undefined
    let hasMetric = source === 'goals'
    let mvHome = g.hs
    let mvAway = g.as
    if (adv) {
      hasMetric = true
      if (source === 'goals5') {
        mvHome = adv.h5g
        mvAway = adv.a5g
      } else if (source === 'xg5') {
        mvHome = adv.h5x
        mvAway = adv.a5x
      } else if (source === 'xgall') {
        mvHome = adv.hxa
        mvAway = adv.axa
      } else {
        mvHome = adv.h5c
        mvAway = adv.a5c
      }
    }
    if (hasMetric) {
      mf[g.home] += mvHome
      ma[g.home] += mvAway
      mf[g.away] += mvAway
      ma[g.away] += mvHome
      mwsum[g.home] += 1
      mwsum[g.away] += 1
      totalMetricW += mvHome + mvAway
      totalMetricWeightW += 2
    }

    totalGoalsW += g.hs + g.as
    totalTeamGamesW += 2
    homeGoalsW += g.hs
    homeGamesW += 1
    awayGoalsW += g.as
    awayGamesW += 1

    for (const [team, scored] of [[g.home, g.hs], [g.away, g.as]] as const) {
      const prev = lastGameWalk[team]
      if (prev) {
        const bucket = restBucket(Math.min(14, daysBetween(prev, g.date)))
        bucketGoals[bucket] += scored
        bucketWeight[bucket] += 1
      }
      lastGameWalk[team] = g.date
    }
  }

  return rows
}
