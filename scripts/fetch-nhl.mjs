import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://api-web.nhle.com/v1'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', 'src', 'data', 'games.json')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (res.ok) return res.json()
    if (res.status === 404) return null
    await sleep(400 * attempt)
  }
  throw new Error('не удалось получить: ' + url)
}

async function collectSeason(startYear, endDate) {
  const games = new Map()
  let date = `${startYear}-09-15`
  let guard = 0
  while (date && guard < 60) {
    guard += 1
    const data = await getJson(`${BASE}/schedule/${date}`)
    if (!data) break
    for (const week of data.gameWeek ?? []) {
      for (const g of week.games ?? []) {
        if (g.gameState !== 'OFF') continue
        if (g.gameType === 1) continue
        const home = g.homeTeam?.abbrev
        const away = g.awayTeam?.abbrev
        const hs = g.homeTeam?.score
        const as = g.awayTeam?.score
        if (!home || !away || hs == null || as == null) continue
        games.set(String(g.id), {
          date: week.date,
          home,
          away,
          hs,
          as,
          outcome: g.gameOutcome?.lastPeriodType ?? 'REG',
        })
      }
    }
    const next = data.nextStartDate
    if (!next || next > endDate) break
    date = next
    await sleep(120)
  }
  return [...games.values()]
}

async function main() {
  const standings = await getJson(`${BASE}/standings/now`)
  const teams = (standings?.standings ?? [])
    .map((s) => ({
      abbrev: s.teamAbbrev?.default,
      name: s.teamName?.default ?? s.teamCommonName?.default ?? s.teamAbbrev?.default,
    }))
    .filter((t) => t.abbrev)

  const currentOnly = process.argv.includes('--current')

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const currentSeasonYear = now.getUTCMonth() + 1 >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  const seasons = currentOnly
    ? [currentSeasonYear]
    : [currentSeasonYear - 2, currentSeasonYear - 1, currentSeasonYear]

  const all = []
  for (const year of seasons) {
    const end = year === currentSeasonYear ? today : `${year + 1}-08-01`
    const games = await collectSeason(year, end)
    console.log(`Сезон ${year}-${String(year + 1).slice(2)}: ${games.length} матчей`)
    all.push(...games)
  }

  // В режиме --current прошлые сезоны берём из уже сохранённого файла (они неизменны).
  let base = []
  if (currentOnly) {
    if (existsSync(OUT)) {
      try {
        const saved = JSON.parse(readFileSync(OUT, 'utf8'))
        const curStart = `${currentSeasonYear}-09-01`
        base = (saved.games ?? []).filter((g) => g.date < curStart)
        console.log(`Из файла сохранено прошлых сезонов: ${base.length} матчей`)
      } catch {
        console.warn('Не удалось прочитать существующий games.json — прошлые сезоны не добавлены')
      }
    } else {
      console.warn('games.json отсутствует — режим --current даст только текущий сезон')
    }
  }

  const unique = new Map(
    [...base, ...all].map((g) => [`${g.date}_${g.home}_${g.away}_${g.hs}-${g.as}`, g]),
  )
  const games = [...unique.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), teams, games }))
  console.log(`Итого: ${games.length} матчей, ${teams.length} команд -> ${OUT}`)
}

main().catch((e) => {
  console.error('ОШИБКА:', e.message)
  process.exit(1)
})
