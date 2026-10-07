// Сбор «продвинутой» статистики из play-by-play NHL: голы и броски (Corsi)
// в равных составах 5v5. Результат — src/data/advanced.json (накапливается).
//
// Запуск: node scripts/fetch-advanced.mjs [--current]
//   --current — только игры текущего сезона (для dev-обновления).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://api-web.nhle.com/v1'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const here = dirname(fileURLToPath(import.meta.url))
const GAMES = join(here, '..', 'src', 'data', 'games.json')
const OUT = join(here, '..', 'src', 'data', 'advanced.json')
const CONCURRENCY = 6

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      if (res.ok) return res.json()
      if (res.status === 404) return null
    } catch {
      /* повтор */
    }
    await sleep(300 * attempt)
  }
  return null
}

function aggregate(pbp) {
  if (!pbp || !Array.isArray(pbp.plays)) return null
  const homeId = pbp.homeTeam?.id
  const awayId = pbp.awayTeam?.id
  if (homeId == null || awayId == null) return null

  let h5g = 0
  let a5g = 0
  let h5c = 0
  let a5c = 0
  let h5x = 0
  let a5x = 0
  // xG по всем составам без пустых ворот (учитывает большинство/меньшинство объёмом бросков).
  let hxa = 0
  let axa = 0
  for (const p of pbp.plays) {
    const sit = p.situationCode
    if (typeof sit !== 'string' || sit.length !== 4) continue
    if (p.periodDescriptor?.periodType === 'SO') continue
    const awayGoalie = Number(sit[0])
    const awaySkaters = Number(sit[1])
    const homeSkaters = Number(sit[2])
    const homeGoalie = Number(sit[3])

    const owner = p.details?.eventOwnerTeamId
    const isHome = owner === homeId
    const isAway = owner === awayId
    if (!isHome && !isAway) continue

    const type = p.typeDescKey
    if (type !== 'goal' && type !== 'shot-on-goal' && type !== 'missed-shot' && type !== 'blocked-shot') continue

    // Простой xG-прокси: затухание по расстоянию до атакуемых ворот (по стороне защиты).
    const x = p.details?.xCoord
    const y = p.details?.yCoord
    let xg = 0
    if (typeof x === 'number' && typeof y === 'number') {
      const side = p.homeTeamDefendingSide
      let goalX = Number.NaN
      if (isHome) goalX = side === 'left' ? 89 : side === 'right' ? -89 : Number.NaN
      else goalX = side === 'left' ? -89 : side === 'right' ? 89 : Number.NaN
      const d = Number.isFinite(goalX)
        ? Math.hypot(x - goalX, y)
        : Math.min(Math.hypot(x - 89, y), Math.hypot(x + 89, y))
      xg = Math.exp(-0.07 * d)
    }

    // Все составы без пустых ворот: у бросающей команды вратарь соперника в воротах.
    const defendingGoalieIn = isHome ? awayGoalie === 1 : homeGoalie === 1
    if (defendingGoalieIn) {
      if (isHome) hxa += xg
      else axa += xg
    }

    const evenStrength = awayGoalie === 1 && homeGoalie === 1 && awaySkaters === 5 && homeSkaters === 5
    if (!evenStrength) continue
    if (isHome) {
      h5c += 1
      h5x += xg
    } else {
      a5c += 1
      a5x += xg
    }
    if (type === 'goal') {
      if (isHome) h5g += 1
      else a5g += 1
    }
  }

  return { h5g, a5g, h5c, a5c, h5x, a5x, hxa, axa }
}

async function pool(items, limit, worker) {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next
      next += 1
      if (i >= items.length) return
      await worker(items[i])
    }
  })
  await Promise.all(runners)
}

async function main() {
  const dataset = JSON.parse(readFileSync(GAMES, 'utf8'))
  const currentOnly = process.argv.includes('--current')

  const now = new Date()
  const currentSeasonYear = now.getUTCMonth() + 1 >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  const curStart = `${currentSeasonYear}-09-01`

  let existing = { generatedAt: null, games: [] }
  if (existsSync(OUT)) {
    try {
      existing = JSON.parse(readFileSync(OUT, 'utf8'))
      if (!Array.isArray(existing.games)) existing.games = []
    } catch {
      existing = { generatedAt: null, games: [] }
    }
  }
  const done = new Set(existing.games.map((g) => g.id))

  let todo = dataset.games.filter((g) => g.id && !done.has(g.id) && g.date)
  if (currentOnly) todo = todo.filter((g) => g.date >= curStart)

  console.log(`Всего игр: ${dataset.games.length}; уже собрано: ${existing.games.length}; к сбору: ${todo.length}`)

  const added = []
  let processed = 0

  const mergeWrite = () => {
    const unique = new Map()
    for (const g of [...existing.games, ...added]) unique.set(g.id, g)
    const games = [...unique.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), games }))
    return games.length
  }

  await pool(todo, CONCURRENCY, async (g) => {
    const pbp = await getJson(`${BASE}/gamecenter/${g.id}/play-by-play`)
    const agg = aggregate(pbp)
    processed += 1
    if (agg) {
      added.push({ id: g.id, date: g.date, home: g.home, away: g.away, ...agg })
    }
    // Промежуточная запись — чтобы прерванный сбор не терял прогресс.
    if (processed % 200 === 0) {
      const total = mergeWrite()
      console.log(`  обработано ${processed}/${todo.length} (собрано всего ${total})`)
    }
  })

  const total = mergeWrite()
  const coverage = dataset.games.length ? (total / dataset.games.length) * 100 : 100
  console.log(`Итого: ${total} игр -> ${OUT} (покрытие ${coverage.toFixed(1)}% от матчей)`)
  if (coverage < 80) {
    console.warn(`ВНИМАНИЕ: 5v5-данные покрывают лишь ${coverage.toFixed(1)}% матчей — запустите сбор без --current.`)
  }
}

main().catch((e) => {
  console.error('ОШИБКА:', e.message)
  process.exit(1)
})
