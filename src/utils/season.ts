/** Границы сезона NHL: сезон начинается 1 сентября. */

/** Год начала сезона, к которому относится дата (2026-10 → 2026, 2026-01 → 2025). */
export function seasonYearOf(date: string): number {
  const [year, month] = date.split('-').map(Number)
  return month >= 9 ? year : year - 1
}

/** Дата начала сезона (1 сентября) для заданной даты. */
export function seasonStartOf(date: string): string {
  return `${seasonYearOf(date)}-09-01`
}
