import raw from '../data/odds.json'
import type { OddsRecord } from '../types'

export const oddsData = (raw as { odds: OddsRecord[] }).odds

export function findMarket(home: string, away: string, date: string): OddsRecord | null {
  const target = Date.parse(date)
  let best: OddsRecord | null = null
  let bestDiff = Number.POSITIVE_INFINITY
  for (const o of oddsData) {
    if (o.home !== home || o.away !== away) continue
    const diff = Math.abs(Date.parse(o.date) - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = o
    }
  }
  return best && bestDiff <= 86_400_000 ? best : null
}

export function blend(modelP: number, marketP: number, weight: number): number {
  return weight * marketP + (1 - weight) * modelP
}
