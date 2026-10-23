import raw from '../data/odds.json'
import type { OddsRecord } from '../types'

export const oddsData = (raw as { odds: OddsRecord[] }).odds

// Индекс по паре команд: поиск кэфа больше не перебирает все записи и не
// пересчитывает Date.parse на каждый вызов (это заметно на пересчёте рамок).
const oddsByPair = new Map<string, Array<{ record: OddsRecord; time: number }>>()
for (const o of oddsData) {
  const key = `${o.home}|${o.away}`
  const list = oddsByPair.get(key)
  const entry = { record: o, time: Date.parse(o.date) }
  if (list) list.push(entry)
  else oddsByPair.set(key, [entry])
}

export function findMarket(home: string, away: string, date: string): OddsRecord | null {
  const list = oddsByPair.get(`${home}|${away}`)
  if (!list) return null
  const target = Date.parse(date)
  let best: OddsRecord | null = null
  let bestDiff = Number.POSITIVE_INFINITY
  for (const { record, time } of list) {
    const diff = Math.abs(time - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = record
    }
  }
  return best && bestDiff <= 86_400_000 ? best : null
}

export function blend(modelP: number, marketP: number, weight: number): number {
  return weight * marketP + (1 - weight) * modelP
}
