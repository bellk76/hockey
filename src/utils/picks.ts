const KEY = 'hockey.picks'

export type PickMap = Record<string, string>

export function readPicks(): PickMap {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: PickMap = {}
    for (const [date, key] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key === 'string') out[date] = key
    }
    return out
  } catch {
    return {}
  }
}

export function writePicks(picks: PickMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(picks))
  } catch {
    /* хранилище недоступно — просто игнорируем */
  }
}
