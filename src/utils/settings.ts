import { useCallback, useState } from 'react'

const PREFIX = 'hockey.'

function read(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    const value = Number(raw)
    return Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: number): void {
  try {
    localStorage.setItem(PREFIX + key, String(value))
  } catch {
    /* хранилище недоступно — просто игнорируем */
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

export const initialBank = clamp(read('bank', 1000), 0, 100_000_000)
export const initialThreshold = clamp(read('ev2', 2), 0, 30)
export const initialBasis = clamp(read('basis2', 0.5), 0, 1)
export const initialMode = Math.round(clamp(read('mode2', 1), 0, 2))
export const initialRisk = clamp(read('risk', 25), 5, 100)
export const initialMinProb = clamp(read('minProb', 45), 0, 60)
export const initialConfidence = clamp(read('conf', 65), 0, 90)
export const initialAgree = Math.round(clamp(read('agree', 0), 0, 1))
export const initialOddsMin = clamp(read('oddsMin2', 1.4), 1, 50)
export const initialOddsMax = clamp(read('oddsMax2', 3), 1, 50)

export function useSetting(initial: number, key: string) {
  const [value, setValue] = useState(initial)
  const set = useCallback(
    (next: number) => {
      setValue(next)
      write(key, next)
    },
    [key],
  )
  return [value, set] as const
}
