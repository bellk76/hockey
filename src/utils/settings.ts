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
export const initialThreshold = clamp(read('ev2', 2), 0, 50)
export const initialBasis = clamp(read('basis2', 0.5), 0, 1)
export const initialMode = Math.round(clamp(read('mode2', 1), 0, 2))
export const initialRisk = clamp(read('risk', 25), 1, 100)

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
