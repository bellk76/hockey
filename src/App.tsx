import { useMemo, useState } from 'react'
import { Bankroll } from './components/Bankroll'
import { MatchList, type ListRow } from './components/MatchList'
import { PredictionView } from './components/PredictionView'
import raw from './data/games.json'
import { buildRatings, predictMatch, walkForward } from './model/model'
import { blend, findMarket, oddsData } from './model/odds'
import type { Game, TeamInfo } from './types'
import { initialBank, useSetting } from './utils/settings'

const dataset = raw as { generatedAt: string; teams: TeamInfo[]; games: Game[] }

const TODAY = (() => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})()

function latestDate(games: Game[]): string {
  return games.reduce((max, g) => (g.date > max ? g.date : max), '2020-01-01')
}

function marketFromOdds(homeOdd: string, awayOdd: string) {
  const h = Number(homeOdd)
  const a = Number(awayOdd)
  if (!(h > 1) || !(a > 1)) return null
  const rh = 1 / h
  const ra = 1 / a
  return { pHome: rh / (rh + ra), pAway: ra / (rh + ra) }
}

export default function App() {
  const teams = useMemo(() => [...dataset.teams].sort((a, b) => a.name.localeCompare(b.name)), [])
  const ratings = useMemo(() => buildRatings(dataset.games, dataset.teams), [])
  const rows = useMemo(() => walkForward(dataset.games, dataset.teams), [])
  const maxDate = useMemo(() => latestDate(dataset.games), [])

  const [home, setHome] = useState(teams[0]?.abbrev ?? '')
  const [away, setAway] = useState(teams[1]?.abbrev ?? '')
  const [date, setDate] = useState(maxDate)
  const [weight, setWeight] = useState(0.5)
  const [oddsHome, setOddsHome] = useState('')
  const [oddsAway, setOddsAway] = useState('')
  const [bank, setBank] = useSetting(initialBank, 'bank')

  const nameOf = (abbrev: string) => teams.find((t) => t.abbrev === abbrev)?.name ?? abbrev
  const sameTeam = home === away
  const prediction = useMemo(
    () => (home && away && !sameTeam ? predictMatch(ratings, home, away, date) : null),
    [ratings, home, away, date, sameTeam],
  )

  const manual = marketFromOdds(oddsHome, oddsAway)
  const auto = home && away ? findMarket(home, away, date) : null
  const market = manual
    ? { ...manual, source: 'ваши коэффициенты' }
    : auto && Number.isFinite(auto.pHome) && Number.isFinite(auto.pAway)
      ? {
          pHome: auto.pHome as number,
          pAway: auto.pAway as number,
          source: `${auto.books ?? 'рынок'} БК · ${auto.date}`,
        }
      : null

  const blended =
    prediction && market
      ? {
          pHome: blend(prediction.pHomeFinal, market.pHome, weight),
          pAway: blend(prediction.pAwayFinal, market.pAway, weight),
        }
      : null

  const dayRows = useMemo(() => rows.filter((r) => r.date === date), [rows, date])

  const upcoming = useMemo<ListRow[]>(() => {
    const seen = new Map<string, ListRow>()
    for (const o of oddsData) {
      if (o.date < TODAY) continue
      seen.set(`${o.date}-${o.home}-${o.away}`, { date: o.date, home: o.home, away: o.away })
    }
    return [...seen.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 15)
  }, [])

  const bets = useMemo(
    () =>
      upcoming.flatMap((u) => {
        const m = findMarket(u.home, u.away, u.date)
        if (!m || !m.oddsOver || !m.oddsUnder || m.pOverMarket === undefined || m.pUnderMarket === undefined) {
          return []
        }
        const p = predictMatch(ratings, u.home, u.away, u.date)
        const homeName = teams.find((t) => t.abbrev === u.home)?.name ?? u.home
        const awayName = teams.find((t) => t.abbrev === u.away)?.name ?? u.away
        return [
          {
            date: u.date,
            homeName,
            awayName,
            pModelOver: p.pOver,
            pModelUnder: 1 - p.pOver,
            pMarketOver: m.pOverMarket,
            pMarketUnder: m.pUnderMarket,
            oddsOver: m.oddsOver,
            oddsUnder: m.oddsUnder,
          },
        ]
      }),
    [upcoming, ratings, teams],
  )

  const accuracy = useMemo(() => {
    const modelRows = rows.filter((r) => Number.isFinite(r.pHome))
    const modelCorrect = modelRows.filter(
      (r) => (r.pHome >= r.pAway ? 'home' : 'away') === (r.hs > r.as ? 'home' : 'away'),
    ).length

    const clamp = (p: number) => Math.min(0.999, Math.max(0.001, p))
    let modelBrier = 0
    let modelLogLoss = 0
    for (const r of modelRows) {
      const p = clamp(r.pHome)
      const y = r.hs > r.as ? 1 : 0
      modelBrier += (p - y) ** 2
      modelLogLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p))
    }
    modelBrier /= Math.max(1, modelRows.length)
    modelLogLoss /= Math.max(1, modelRows.length)

    const byTeams = new Map<string, Game[]>()
    for (const g of dataset.games) {
      const key = `${g.home}-${g.away}`
      const list = byTeams.get(key) ?? []
      list.push(g)
      byTeams.set(key, list)
    }
    let marketTotal = 0
    let marketCorrect = 0
    let marketBrier = 0
    let marketLogLoss = 0
    for (const o of oddsData) {
      const day = Date.parse(o.date)
      const game = (byTeams.get(`${o.home}-${o.away}`) ?? [])
        .map((g) => ({ g, d: Math.abs(Date.parse(g.date) - day) }))
        .filter((x) => x.d <= 86_400_000)
        .sort((a, b) => a.d - b.d)[0]?.g
      if (!game || o.pHome === undefined || o.pAway === undefined) continue
      marketTotal += 1
      const p = clamp(o.pHome)
      const y = game.hs > game.as ? 1 : 0
      if ((o.pHome >= o.pAway ? 'home' : 'away') === (game.hs > game.as ? 'home' : 'away')) marketCorrect += 1
      marketBrier += (p - y) ** 2
      marketLogLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p))
    }
    marketBrier /= Math.max(1, marketTotal)
    marketLogLoss /= Math.max(1, marketTotal)
    return {
      modelTotal: modelRows.length,
      modelCorrect,
      modelBrier,
      modelLogLoss,
      marketTotal,
      marketCorrect,
      marketBrier,
      marketLogLoss,
    }
  }, [rows])

  const marketOf = (h: string, a: string, d: string) => {
    const m = findMarket(h, a, d)
    return m && Number.isFinite(m.pHome) && Number.isFinite(m.pAway)
      ? { pHome: m.pHome as number, pAway: m.pAway as number }
      : null
  }

  const select = (h: string, a: string, d: string) => {
    setHome(h)
    setAway(a)
    setDate(d)
  }

  const modelAccuracy = dayRows.filter(
    (r) => Number.isFinite(r.pHome) && (r.pHome >= r.pAway ? 'home' : 'away') === (r.hs > r.as ? 'home' : 'away'),
  ).length
  const playedCount = dayRows.filter((r) => Number.isFinite(r.pHome)).length

  return (
    <div className="app">
      <header>
        <h1>Hockey — прогноз матчей NHL</h1>
        <p className="caption">
          Данные: {dataset.games.length} матчей, {dataset.teams.length} команд · обновлено{' '}
          {dataset.generatedAt.slice(0, 10)}
        </p>
      </header>

      <div className="controls">
        <label>
          Хозяева
          <select value={home} onChange={(e) => setHome(e.target.value)}>
            {teams.map((t) => (
              <option key={t.abbrev} value={t.abbrev}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Гости
          <select value={away} onChange={(e) => setAway(e.target.value)}>
            {teams.map((t) => (
              <option key={t.abbrev} value={t.abbrev}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Дата
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Кэф хозяев (необяз.)
          <input value={oddsHome} onChange={(e) => setOddsHome(e.target.value)} placeholder="1.85" />
        </label>
        <label>
          Кэф гостей (необяз.)
          <input value={oddsAway} onChange={(e) => setOddsAway(e.target.value)} placeholder="2.10" />
        </label>
      </div>

      {sameTeam && <p className="error">Выберите две разные команды</p>}

      {prediction && (
        <PredictionView
          homeName={nameOf(home)}
          awayName={nameOf(away)}
          prediction={prediction}
          market={market}
          blended={blended}
          weight={weight}
          onWeight={setWeight}
          note={
            date < maxDate
              ? 'Для прошедшей даты показаны рейтинги на последнюю дату данных, а не walk-forward. Честный прогноз на этот день — в списке «Матчи на…».'
              : undefined
          }
        />
      )}

      <section className="matches">
        <h2>Точность: модель и рынок</h2>
        <div className="grid">
          <div>
            <span className="label">Модель · все матчи</span>
            <strong>
              {((accuracy.modelCorrect / Math.max(1, accuracy.modelTotal)) * 100).toFixed(1)}% ({accuracy.modelCorrect}/{accuracy.modelTotal})
            </strong>
          </div>
          <div>
            <span className="label">Рынок · матчи с кэфами</span>
            <strong>
              {accuracy.marketTotal
                ? `${((accuracy.marketCorrect / accuracy.marketTotal) * 100).toFixed(1)}% (${accuracy.marketCorrect}/${accuracy.marketTotal})`
                : 'нет данных'}
            </strong>
          </div>
          <div>
            <span className="label">Brier · модель (меньше = лучше)</span>
            <strong>{accuracy.modelBrier.toFixed(3)}</strong>
          </div>
          <div>
            <span className="label">Brier · рынок</span>
            <strong>{accuracy.marketTotal ? accuracy.marketBrier.toFixed(3) : '—'}</strong>
          </div>
          <div>
            <span className="label">Log-loss · модель</span>
            <strong>{accuracy.modelLogLoss.toFixed(3)}</strong>
          </div>
          <div>
            <span className="label">Log-loss · рынок</span>
            <strong>{accuracy.marketTotal ? accuracy.marketLogLoss.toFixed(3) : '—'}</strong>
          </div>
        </div>
        <p className="caption">
          Модель — walk-forward (только по прошлым матчам). Рынок — по собранным кэфам, где есть результат.
        </p>
      </section>

      <MatchList
        title={`Матчи на ${date}`}
        rows={dayRows}
        nameOf={nameOf}
        marketOf={marketOf}
        onSelect={select}
        emptyText="В этот день матчей нет — выбери другую дату или матч из списка ниже."
      />
      {playedCount > 0 && (
        <p className="caption summary">
          Модель угадала исход в {modelAccuracy} из {playedCount} матчей этого дня. Клик по матчу — прогноз на него.
        </p>
      )}

      <MatchList
        title="Ближайшие матчи с кэфами"
        rows={upcoming}
        nameOf={nameOf}
        marketOf={marketOf}
        onSelect={select}
        emptyText="Нет собранных ближайших матчей с кэфами."
      />

      <Bankroll bets={bets} bank={bank} onBank={setBank} day={TODAY} />
    </div>
  )
}
