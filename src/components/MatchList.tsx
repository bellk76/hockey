import type { Game } from '../types'
import { FORM_N } from '../utils/form'

export interface ListRow {
  date: string
  home: string
  away: string
  hs?: number
  as?: number
  outcome?: string
  pHome?: number
  pAway?: number
}

export interface MarketLookup {
  (home: string, away: string, date: string): { pHome?: number; pAway?: number; pOver?: number } | null
}

interface MatchListProps {
  title: string
  rows: ListRow[]
  nameOf: (abbrev: string) => string
  marketOf: MarketLookup
  onSelect: (home: string, away: string, date: string) => void
  emptyText: string
  fullDate?: boolean
  minConfidence?: number
  collapsibleDays?: boolean
  bestOf?: (date: string) => string | null
  recentOf?: (team: string, date: string, n?: number) => Game[]
}

function outcomeLabel(outcome?: string): string {
  if (outcome === 'OT') return 'ОТ'
  if (outcome === 'SO') return 'БУЛ'
  return ''
}

function favourite(pHome: number, pAway: number): 'home' | 'away' {
  return pHome >= pAway ? 'home' : 'away'
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`
}

function plural(n: number, forms: [string, string, string]): string {
  const n10 = n % 10
  const n100 = n % 100
  if (n10 === 1 && n100 !== 11) return forms[0]
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1]
  return forms[2]
}

export function MatchList({
  title,
  rows,
  nameOf,
  marketOf,
  onSelect,
  emptyText,
  fullDate,
  minConfidence,
  collapsibleDays,
  bestOf,
  recentOf,
}: MatchListProps) {
  const byDate = new Map<string, ListRow[]>()
  for (const r of rows) {
    const list = byDate.get(r.date) ?? []
    list.push(r)
    byDate.set(r.date, list)
  }

  const renderMatch = (r: ListRow, isBest: boolean, showDate: boolean) => {
    const key = `${r.date}-${r.home}-${r.away}`
    const played = r.hs !== undefined && r.as !== undefined
    const winner = played ? (r.hs! > r.as! ? 'home' : 'away') : null
    const hasModel = Number.isFinite(r.pHome) && Number.isFinite(r.pAway)
    const modelOk = hasModel && played && winner !== null && favourite(r.pHome!, r.pAway!) === winner
    const modelFavTeam = hasModel
      ? favourite(r.pHome!, r.pAway!) === 'home'
        ? nameOf(r.home)
        : nameOf(r.away)
      : ''
    const market = marketOf(r.home, r.away, r.date)
    const hasMarket = !!market && Number.isFinite(market.pHome) && Number.isFinite(market.pAway)
    const marketOk =
      hasMarket && winner !== null ? favourite(market!.pHome as number, market!.pAway as number) === winner : null
    const marketFavTeam = hasMarket
      ? favourite(market!.pHome as number, market!.pAway as number) === 'home'
        ? nameOf(r.home)
        : nameOf(r.away)
      : ''

    const formTeams = recentOf
      ? [
          { team: r.home, side: 'home' },
          { team: r.away, side: 'away' },
        ].map((entry) => ({ ...entry, games: recentOf(entry.team, r.date, FORM_N) }))
      : []
    const formShown = formTeams.reduce((max, t) => Math.max(max, t.games.length), 0)

    return (
      <details key={key} className={`match${isBest ? ' best' : ''}`}>
        <summary className="match-summary">
          {showDate && <span className="match-date">{fullDate ? r.date : r.date.slice(5)}</span>}
          <span className="match-teams">
            <span className="team home">{nameOf(r.home)}</span>
            <span className="score">
              {played ? `${r.hs} : ${r.as}` : '—'}
              {outcomeLabel(r.outcome) && <em className="badge">{outcomeLabel(r.outcome)}</em>}
            </span>
            <span className="team away">{nameOf(r.away)}</span>
          </span>
          <span className="match-flag">
            {isBest && <span className="best-badge">★</span>}
            {played && hasModel ? (
              <span className={modelOk ? 'ok' : 'bad'}>{modelOk ? '✓' : '✗'}</span>
            ) : (
              ''
            )}
          </span>
        </summary>

        <div className="match-detail">
          {hasModel && (
            <span className={played ? (modelOk ? 'ok' : 'bad') : 'model'}>
              модель · исход {modelFavTeam} {pct(Math.max(r.pHome!, r.pAway!))}
              {played ? (modelOk ? ' ✓' : ' ✗') : ''}
            </span>
          )}
          <span className={hasMarket ? (played ? (marketOk === false ? 'bad' : 'ok') : 'market') : 'market'}>
            {hasMarket
              ? `рынок · исход ${marketFavTeam} ${pct(Math.max(market!.pHome as number, market!.pAway as number))}${played ? (marketOk ? ' ✓' : ' ✗') : ''}`
              : 'рынок · исход —'}
          </span>
          <button type="button" className="chip" onClick={() => onSelect(r.home, r.away, r.date)}>
            Прогноз на матч
          </button>
          {recentOf && (
            <div className="match-form">
              <p className="match-form-title">
                Форма команд
                {formShown > 0 && (
                  <>
                    {' · последние '}
                    {formShown} {plural(formShown, ['матч', 'матча', 'матчей'])}
                  </>
                )}
              </p>
              {formTeams.map(({ team, side, games }) => (
                <div className="match-form-team" key={side}>
                  <span className="match-form-club">{nameOf(team)}</span>
                  <span className="match-form-games">
                    {games.map((g) => {
                      const isHome = g.home === team
                      const own = isHome ? g.hs : g.as
                      const opp = isHome ? g.as : g.hs
                      const tone = own > opp ? 'ok' : own < opp ? 'bad' : 'draw'
                      const resultText = own > opp ? 'победа' : own < opp ? 'поражение' : 'ничья'
                      const keyClass = `match-form-key ${tone}`
                      return (
                        <span key={g.id ?? `${g.date}-${g.home}-${g.away}`} className="match-form-game">
                          <span className={`match-form-dot ${tone}`} aria-hidden="true">
                            ●
                          </span>{' '}
                          {g.date.slice(5)}{' '}
                          <span className={isHome ? keyClass : undefined}>{nameOf(g.home)}</span>
                          {' — '}
                          <span className={isHome ? undefined : keyClass}>{nameOf(g.away)}</span>{' '}
                          <b className={tone}>{g.hs}:{g.as}</b>
                          <span className="sr-only"> {resultText}</span>
                        </span>
                      )
                    })}
                    {games.length === 0 && <span className="match-form-empty">нет сыгранных матчей</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    )
  }

  return (
    <section className="matches">
      <h2>{title}</h2>
      {rows.length === 0 && <p className="caption">{emptyText}</p>}
      {[...byDate.entries()].map(([day, dayRows], dayIndex) => {
        const min = minConfidence ?? 0
        let bestKey: string | null = bestOf ? bestOf(day) : null
        let bestProb = -1
        let modelTotal = 0
        let modelCorrect = 0
        let marketTotal = 0
        let marketCorrect = 0
        for (const r of dayRows) {
          const played = r.hs !== undefined && r.as !== undefined
          const winner = played ? (r.hs! > r.as! ? 'home' : 'away') : null
          const hasModel = Number.isFinite(r.pHome) && Number.isFinite(r.pAway)
          const m = marketOf(r.home, r.away, r.date)
          const hasMarket = !!m && Number.isFinite(m.pHome) && Number.isFinite(m.pAway)
          if (played && hasModel) {
            modelTotal += 1
            if (favourite(r.pHome!, r.pAway!) === winner) modelCorrect += 1
          }
          if (played && hasMarket) {
            marketTotal += 1
            if (favourite(m!.pHome as number, m!.pAway as number) === winner) marketCorrect += 1
          }
          if (bestOf || !hasModel || !hasMarket) continue
          const modelFav = (r.pHome as number) >= (r.pAway as number) ? 'home' : 'away'
          const marketFav = (m!.pHome as number) >= (m!.pAway as number) ? 'home' : 'away'
          if (modelFav !== marketFav) continue
          const p = Math.max(r.pHome as number, (r.pAway ?? 0) as number)
          if (Math.round(p * 100) >= Math.round(min * 100) && p > bestProb) {
            bestProb = p
            bestKey = `${r.home}-${r.away}`
          }
        }
        const body = dayRows.map((r) => renderMatch(r, `${r.home}-${r.away}` === bestKey, !collapsibleDays))
        if (!collapsibleDays) {
          return (
            <div key={day} className="match-day">
              {body}
            </div>
          )
        }
        const n = dayRows.length
        return (
          <details key={day} className="match-day" open={dayIndex < 3}>
            <summary className="match-day-summary">
              <span className="match-day-date">{fullDate ? day : day.slice(5)}</span>
              <span className="match-day-meta">
                <span>
                  {n} {plural(n, ['матч', 'матча', 'матчей'])}
                </span>
                {modelTotal > 0 && (
                  <span>
                    модель {modelCorrect}/{modelTotal}
                  </span>
                )}
                {marketTotal > 0 && (
                  <span>
                    рынок {marketCorrect}/{marketTotal}
                  </span>
                )}
              </span>
              {bestKey && <span className="best-badge">★</span>}
            </summary>
            {body}
          </details>
        )
      })}
    </section>
  )
}
