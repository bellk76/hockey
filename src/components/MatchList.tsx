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

export function MatchList({ title, rows, nameOf, marketOf, onSelect, emptyText, fullDate, minConfidence }: MatchListProps) {
  const byDate = new Map<string, ListRow[]>()
  for (const r of rows) {
    const list = byDate.get(r.date) ?? []
    list.push(r)
    byDate.set(r.date, list)
  }

  const renderMatch = (r: ListRow, isBest: boolean) => {
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

    return (
      <details key={key} className={`match${isBest ? ' best' : ''}`}>
        <summary className="match-summary">
          <span className="match-date">{fullDate ? r.date : r.date.slice(5)}</span>
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
        </div>
      </details>
    )
  }

  return (
    <section className="matches">
      <h2>{title}</h2>
      {rows.length === 0 && <p className="caption">{emptyText}</p>}
      {[...byDate.entries()].map(([day, dayRows]) => {
        const min = minConfidence ?? 0
        let bestKey: string | null = null
        let bestProb = -1
        for (const r of dayRows) {
          if (!Number.isFinite(r.pHome)) continue
          const m = marketOf(r.home, r.away, r.date)
          if (!m || !Number.isFinite(m.pHome) || !Number.isFinite(m.pAway)) continue
          const modelFav = (r.pHome as number) >= (r.pAway as number) ? 'home' : 'away'
          const marketFav = (m.pHome as number) >= (m.pAway as number) ? 'home' : 'away'
          if (modelFav !== marketFav) continue
          const p = Math.max(r.pHome as number, (r.pAway ?? 0) as number)
          if (Math.round(p * 100) >= Math.round(min * 100) && p > bestProb) {
            bestProb = p
            bestKey = `${r.date}-${r.home}-${r.away}`
          }
        }
        return (
          <div key={day} className="match-day">
            {dayRows.map((r) => renderMatch(r, `${r.date}-${r.home}-${r.away}` === bestKey))}
          </div>
        )
      })}
    </section>
  )
}
