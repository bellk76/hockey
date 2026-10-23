import { describe, expect, it } from 'vitest'
import {
  marketBestOfDay,
  marketPicksByDay,
  tallySuperMatches,
  type BestRow,
  type MarketProbLookup,
} from './best'

function market(probs: Record<string, { pHome: number; pAway: number }>): MarketProbLookup {
  return (home, away, date) => probs[`${date}|${home}-${away}`] ?? null
}

describe('marketBestOfDay · суперматч по рынку', () => {
  const rows: BestRow[] = [
    { date: '2026-10-08', home: 'CAR', away: 'VAN' },
    { date: '2026-10-08', home: 'BOS', away: 'NJD' },
    { date: '2026-10-09', home: 'COL', away: 'TBL' },
  ]

  it('выбирает самый уверенный по рынку матч дня', () => {
    const of = market({
      '2026-10-08|CAR-VAN': { pHome: 0.62, pAway: 0.38 },
      '2026-10-08|BOS-NJD': { pHome: 0.45, pAway: 0.55 },
      // Другой день не должен попадать в выбор дня 08.
      '2026-10-09|COL-TBL': { pHome: 0.8, pAway: 0.2 },
    })
    expect(marketBestOfDay(rows, '2026-10-08', of, 0.5)).toBe('CAR-VAN')
  })

  it('не выбирает матч ниже порога и включает ровно на границе', () => {
    const of = market({
      '2026-10-08|CAR-VAN': { pHome: 0.68, pAway: 0.32 },
      '2026-10-08|BOS-NJD': { pHome: 0.45, pAway: 0.55 },
    })
    expect(marketBestOfDay(rows, '2026-10-08', of, 0.68)).toBe('CAR-VAN')
    expect(marketBestOfDay(rows, '2026-10-08', of, 0.69)).toBeNull()
  })

  it('учитывает вероятность аутсайдера-гостя как фаворита', () => {
    const of = market({ '2026-10-08|BOS-NJD': { pHome: 0.3, pAway: 0.7 } })
    expect(marketBestOfDay(rows, '2026-10-08', of, 0.68)).toBe('BOS-NJD')
  })

  it('возвращает null, если рынка нет или порог некорректен', () => {
    expect(marketBestOfDay(rows, '2026-10-08', () => null, 0.5)).toBeNull()
    expect(marketBestOfDay(rows, '2026-10-10', market({}), 0.5)).toBeNull()
    expect(marketBestOfDay(rows, '2026-10-08', market({}), Number.NaN)).toBeNull()
  })

  it('игнорирует NaN/undefined в вероятностях', () => {
    const of: MarketProbLookup = () => ({ pHome: Number.NaN, pAway: 0.5 })
    expect(marketBestOfDay(rows, '2026-10-08', of, 0)).toBeNull()
    const noAway: MarketProbLookup = () => ({ pHome: 0.9 })
    expect(marketBestOfDay(rows, '2026-10-08', noAway, 0)).toBeNull()
  })

  it('при равных вероятностях оставляет первый матч дня', () => {
    const of = market({
      '2026-10-08|CAR-VAN': { pHome: 0.7, pAway: 0.3 },
      '2026-10-08|BOS-NJD': { pHome: 0.3, pAway: 0.7 },
    })
    expect(marketBestOfDay(rows, '2026-10-08', of, 0.68)).toBe('CAR-VAN')
  })
})

describe('marketPicksByDay · выборы по всем дням', () => {
  const rows: BestRow[] = [
    { date: '2026-10-08', home: 'CAR', away: 'VAN' },
    { date: '2026-10-08', home: 'BOS', away: 'NJD' },
    { date: '2026-10-09', home: 'COL', away: 'TBL' },
    { date: '2026-10-10', home: 'CGY', away: 'EDM' },
  ]

  it('группирует по датам и применяет порог к каждому дню', () => {
    const of = market({
      '2026-10-08|CAR-VAN': { pHome: 0.62, pAway: 0.38 },
      '2026-10-08|BOS-NJD': { pHome: 0.72, pAway: 0.28 },
      '2026-10-09|COL-TBL': { pHome: 0.6, pAway: 0.4 },
      '2026-10-10|CGY-EDM': { pHome: 0.55, pAway: 0.45 },
    })
    expect(marketPicksByDay(rows, of, 0.68)).toEqual({
      '2026-10-08': 'BOS-NJD',
    })
  })

  it('возвращает пустой объект без данных', () => {
    expect(marketPicksByDay([], market({}), 0.68)).toEqual({})
    expect(marketPicksByDay(rows, () => null, 0.68)).toEqual({})
  })
})

describe('tallySuperMatches · сводка суперматчей', () => {
  const played: BestRow[] = [
    { date: '2026-10-08', home: 'CAR', away: 'VAN', hs: 4, as: 2 },
    { date: '2026-10-09', home: 'COL', away: 'TBL', hs: 1, as: 3 },
    { date: '2026-10-10', home: 'CGY', away: 'EDM', hs: 2, as: 2 },
  ]
  const upcoming: BestRow[] = [
    { date: '2026-10-23', home: 'CHI', away: 'MTL' },
    { date: '2026-10-24', home: 'EDM', away: 'TOR' },
  ]
  const favHome = (r: BestRow) => (r.home === 'COL' ? 'away' : 'home') as 'home' | 'away'

  it('считает угаданные, промахи и будущие выборы', () => {
    const playedPicks = {
      '2026-10-08': 'CAR-VAN', // угадан (хозяева)
      '2026-10-09': 'COL-TBL', // угадан (гости)
    }
    const upcomingPicks = { '2026-10-23': 'CHI-MTL' }
    expect(tallySuperMatches(played, playedPicks, upcoming, upcomingPicks, favHome)).toEqual({
      played: 2,
      wins: 2,
      losses: 0,
      upcoming: 1,
    })
  })

  it('считает промах, когда победил не фаворит', () => {
    const playedPicks = { '2026-10-08': 'CAR-VAN' }
    const favAway = () => 'away' as const
    expect(tallySuperMatches(played, playedPicks, upcoming, {}, favAway)).toEqual({
      played: 1,
      wins: 0,
      losses: 1,
      upcoming: 0,
    })
  })

  it('игнорирует выборы без матча, без счёта, с ничьей и без фаворита', () => {
    const playedPicks = {
      '2026-10-08': 'CAR-VAN', // без фаворита
      '2026-10-10': 'CGY-EDM', // ничья
      '2026-10-20': 'XXX-YYY', // такого матча нет
    }
    expect(tallySuperMatches(played, playedPicks, upcoming, {}, () => null)).toEqual({
      played: 0,
      wins: 0,
      losses: 0,
      upcoming: 0,
    })
    expect(tallySuperMatches(played, { '2026-10-10': 'CGY-EDM' }, upcoming, {}, favHome)).toEqual({
      played: 0,
      wins: 0,
      losses: 0,
      upcoming: 0,
    })
    const noScore: BestRow[] = [...played, { date: '2026-10-11', home: 'NYR', away: 'BOS' }]
    expect(tallySuperMatches(noScore, { '2026-10-11': 'NYR-BOS' }, upcoming, {}, favHome)).toEqual({
      played: 0,
      wins: 0,
      losses: 0,
      upcoming: 0,
    })
  })

  it('не смешивает прошедшие и будущие выборы', () => {
    const playedPicks = { '2026-10-23': 'CHI-MTL' } // будущий матч в прошедшей карте
    const upcomingPicks = { '2026-10-08': 'CAR-VAN' } // прошедший матч в будущей карте
    expect(tallySuperMatches(played, playedPicks, upcoming, upcomingPicks, favHome)).toEqual({
      played: 0,
      wins: 0,
      losses: 0,
      upcoming: 0,
    })
  })
})
