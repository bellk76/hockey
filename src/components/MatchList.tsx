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
  (home: string, away: string, date: string): { pHome: number; pAway: number } | null
}

interface MatchListProps {
  title: string
  rows: ListRow[]
  nameOf: (abbrev: string) => string
  marketOf: MarketLookup
  onSelect: (home: string, away: string, date: string) => void
  emptyText: string
}

function outcomeLabel(outcome?: string): string {
  if (outcome === 'OT') return 'ОТ'
  if (outcome === 'SO') return 'БУЛ'
  return ''
}

function favourite(pHome: number, pAway: number): 'home' | 'away' {
  return pHome >= pAway ? 'home' : 'away'
}

export function MatchList({ title, rows, nameOf, marketOf, onSelect, emptyText }: MatchListProps) {
  return (
    <section className="matches">
      <h2>{title}</h2>
      {rows.length === 0 && <p className="caption">{emptyText}</p>}
      {rows.map((r) => {
        const played = r.hs !== undefined && r.as !== undefined
        const winner = played ? (r.hs! > r.as! ? 'home' : 'away') : null
        const hasModel = played && Number.isFinite(r.pHome)
        const modelOk = hasModel && winner !== null && favourite(r.pHome!, r.pAway!) === winner
        const market = marketOf(r.home, r.away, r.date)
        const marketOk = market && winner !== null ? favourite(market.pHome, market.pAway) === winner : null
        return (
          <button
            type="button"
            key={`${r.date}-${r.home}-${r.away}`}
            className="match"
            onClick={() => onSelect(r.home, r.away, r.date)}
          >
            <span className="match-teams">
              <span className="team home">{nameOf(r.home)}</span>
              <span className="score">
                {played ? `${r.hs} : ${r.as}` : r.date.slice(5)}
                {outcomeLabel(r.outcome) && <em className="badge">{outcomeLabel(r.outcome)}</em>}
              </span>
              <span className="team away">{nameOf(r.away)}</span>
            </span>
            <span className="match-meta">
              {hasModel && (
                <span className={modelOk ? 'ok' : 'bad'}>
                  модель · исход {(Math.max(r.pHome!, r.pAway!) * 100).toFixed(0)}% {modelOk ? '✓' : '✗'}
                </span>
              )}
              {market && (
                <span className={marketOk === false ? 'bad' : 'ok'}>
                  рынок · исход {(Math.max(market.pHome, market.pAway) * 100).toFixed(0)}%
                  {winner !== null ? (marketOk ? ' ✓' : ' ✗') : ''}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </section>
  )
}
