// Подбор гиперпараметров модели по walk-forward метрикам (Brier / log-loss).
// Запуск: node scripts/tune.mjs [число_сэмплов]
// Все измерения — честные (walk-forward), сравнение — с рынком.

import { readFileSync } from 'node:fs'
import { advancedKey, defaultModelConfig, walkForward } from '../src/model/model.ts'

const root = new URL('..', import.meta.url)
const dataset = JSON.parse(readFileSync(new URL('src/data/games.json', root), 'utf8'))
const oddsRaw = JSON.parse(readFileSync(new URL('src/data/odds.json', root), 'utf8')).odds
const advRaw = JSON.parse(readFileSync(new URL('src/data/advanced.json', root), 'utf8'))
const games = dataset.games
const teams = dataset.teams
const advanced = {}
for (const g of advRaw.games ?? []) {
  advanced[advancedKey(g.date, g.home, g.away)] = {
    h5g: g.h5g,
    a5g: g.a5g,
    h5c: g.h5c,
    a5c: g.a5c,
    h5x: g.h5x,
    a5x: g.a5x,
    hxa: g.hxa,
    axa: g.axa,
  }
}

const clamp = (p) => Math.min(0.999, Math.max(0.001, p))

function seasonOf(date) {
  const [year, month] = date.split('-').map(Number)
  return month >= 9 ? year : year - 1
}

function metrics(rows, seasonsFilter) {
  let brier = 0
  let logLoss = 0
  let n = 0
  let correct = 0
  for (const r of rows) {
    if (!Number.isFinite(r.pHome)) continue
    if (seasonsFilter && !seasonsFilter.has(seasonOf(r.date))) continue
    const p = clamp(r.pHome)
    const y = r.hs > r.as ? 1 : 0
    brier += (p - y) ** 2
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p))
    if ((r.pHome >= r.pAway ? 1 : 0) === y) correct += 1
    n += 1
  }
  return n ? { n, brier: brier / n, logLoss: logLoss / n, acc: correct / n } : { n: 0 }
}

function seasonBriers(rows) {
  const bySeason = new Map()
  for (const r of rows) {
    if (!Number.isFinite(r.pHome)) continue
    const s = seasonOf(r.date)
    if (!bySeason.has(s)) bySeason.set(s, [])
    bySeason.get(s).push(r)
  }
  const out = {}
  for (const [s, rs] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
    out[s] = metrics(rs)
  }
  return out
}

// --- рынок как ориентир ---
function findMarket(home, away, date) {
  const target = Date.parse(date)
  let best = null
  let bestDiff = Infinity
  for (const o of oddsRaw) {
    if (o.home !== home || o.away !== away) continue
    const diff = Math.abs(Date.parse(o.date) - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = o
    }
  }
  return best && bestDiff <= 86400000 ? best : null
}

function marketMetrics(rows) {
  let brier = 0
  let logLoss = 0
  let n = 0
  let correct = 0
  for (const r of rows) {
    if (!Number.isFinite(r.pHome)) continue
    const m = findMarket(r.home, r.away, r.date)
    if (!m || !Number.isFinite(m.pHome) || !Number.isFinite(m.pAway)) continue
    const p = clamp(m.pHome)
    const y = r.hs > r.as ? 1 : 0
    brier += (p - y) ** 2
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p))
    if ((m.pHome >= m.pAway ? 1 : 0) === y) correct += 1
    n += 1
  }
  return n ? { n, brier: brier / n, logLoss: logLoss / n, acc: correct / n } : { n: 0 }
}

const fmt = (m) => `n=${String(m.n).padStart(5)}  Brier=${m.brier.toFixed(4)}  logLoss=${m.logLoss.toFixed(4)}  acc=${(m.acc * 100).toFixed(1)}%`

// базовый прогон
const baseRows = walkForward(games, teams, defaultModelConfig, advanced)
const seasons = [...new Set(baseRows.filter((r) => Number.isFinite(r.pHome)).map((r) => seasonOf(r.date)))].sort()
const valSeason = seasons[seasons.length - 1]
const valSet = new Set([valSeason])

console.log('Сезоны:', seasons.join(', '), '| валидация:', valSeason)
console.log('\n=== Базовая модель (текущие дефолты) ===')
console.log('все:      ', fmt(metrics(baseRows)))
console.log('валидация:', fmt(metrics(baseRows, valSet)))
for (const [s, m] of Object.entries(seasonBriers(baseRows))) console.log(`  сезон ${s}: ${fmt(m)}`)
console.log('\n=== Рынок (где есть кэфы) ===')
console.log('все:      ', fmt(marketMetrics(baseRows)))
console.log('валидация:', fmt(marketMetrics(baseRows.filter((r) => valSet.has(seasonOf(r.date))))))

// --- поиск ---
const space = {
  strengthSource: ['goals', 'goals5', 'corsi5', 'xg5', 'xgall'],
  halfLifeDays: [90, 110, 130, 150, 180, 210, 240, 300, 365],
  travelCoef: [0, 0.005, 0.01, 0.015, 0.02, 0.03],
  travelFloor: [0.85, 0.88, 0.9, 0.92, 0.95, 1],
  priorGames: [0, 1, 2, 4, 6, 10, 15, 20, 30],
  dixonColesRho: [0, 0.02, 0.04, 0.06, 0.08, 0.1],
  otHomeShare: [0.5, 0.52, 0.54, 0.56],
  eloWeight: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  probShrink: [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1],
}
const keys = Object.keys(space)
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)]
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const N = Number(process.argv[2]) || 1500
const rng = mulberry32(12345)
const results = []
for (let i = 0; i < N; i += 1) {
  const cfg = { ...defaultModelConfig }
  for (const k of keys) cfg[k] = pick(space[k], rng)
  const rows = walkForward(games, teams, cfg, advanced)
  const all = metrics(rows)
  const val = metrics(rows, valSet)
  const sb = seasonBriers(rows)
  const perSeason = seasons.map((s) => (sb[s] ? sb[s].brier : 0))
  const meanSeasonBrier = perSeason.reduce((a, b) => a + b, 0) / seasons.length
  results.push({ cfg, all, val, meanSeasonBrier })
}

console.log(`\n=== Топ-10 по overall Brier (из ${N}) ===`)
for (const r of [...results].sort((a, b) => a.all.brier - b.all.brier).slice(0, 10)) {
  console.log(`${fmt(r.all)}  val=${r.val.brier.toFixed(4)}  meanSeason=${r.meanSeasonBrier.toFixed(4)}  ${JSON.stringify(r.cfg)}`)
}
console.log(`\n=== Топ-10 по валидации (сезон ${valSeason}) ===`)
for (const r of [...results].sort((a, b) => a.val.brier - b.val.brier).slice(0, 10)) {
  console.log(`${fmt(r.val)}  all=${r.all.brier.toFixed(4)}  ${JSON.stringify(r.cfg)}`)
}

const best = [...results].sort((a, b) => a.all.brier - b.all.brier)[0]
console.log('\nЛучший overall cfg:', JSON.stringify(best.cfg))

function report(tag, cfg) {
  const rows = walkForward(games, teams, cfg, advanced)
  const sb = seasonBriers(rows)
  const parts = Object.entries(sb).map(([s, m]) => `${s}:${m.brier.toFixed(4)}`)
  console.log(`${tag.padEnd(24)} all ${fmt(metrics(rows))}  |  ${parts.join('  ')}`)
}

console.log('\n=== Калибровка исхода (probShrink) ===')
for (const probShrink of [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1]) {
  report(`probShrink=${probShrink}`, { ...defaultModelConfig, probShrink })
}
console.log('\n=== Elo в прогнозе (corsi5, prior=10) ===')
for (const eloWeight of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
  report(`eloWeight=${eloWeight}`, { ...defaultModelConfig, eloWeight })
}
console.log('\n=== Источники силы (combined с eloWeight=0.2) ===')
for (const src of ['goals', 'goals5', 'corsi5', 'xg5', 'xgall']) {
  report(`source=${src}`, { ...defaultModelConfig, strengthSource: src })
}
console.log('\n=== Источники силы + prior (подбор) ===')
for (const src of ['goals', 'corsi5', 'xg5']) {
  for (const priorGames of [5, 10, 20]) {
    report(`${src} prior=${priorGames}`, { ...defaultModelConfig, strengthSource: src, priorGames })
  }
}
