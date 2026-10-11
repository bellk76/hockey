// Эксперимент: помогает ли «серийная» корректировка вероятностей в самом прогнозе?
// walk-forward: серии считаются только по матчам до даты (streakOf фильтрует date < d).
// Требуется Node >= 22.6 (type stripping для импортов .ts).
// Запуск: npm run streak-exp  (или: node scripts/streak-exp.mjs)

import { readFileSync } from 'node:fs'
import { advancedKey, defaultModelConfig, walkForward } from '../src/model/model.ts'
import { seasonYearOf } from '../src/utils/season.ts'
import { streakOf } from '../src/utils/streaks.ts'

const root = new URL('..', import.meta.url)
const dataset = JSON.parse(readFileSync(new URL('src/data/games.json', root), 'utf8'))
const advRaw = JSON.parse(readFileSync(new URL('src/data/advanced.json', root), 'utf8'))
const games = dataset.games
const teams = dataset.teams
const advanced = {}
for (const g of advRaw.games ?? []) {
  advanced[advancedKey(g.date, g.home, g.away)] = {
    h5g: g.h5g, a5g: g.a5g, h5c: g.h5c, a5c: g.a5c,
    h5x: g.h5x, a5x: g.a5x, hxa: g.hxa, axa: g.axa,
  }
}

const clamp = (p) => Math.min(0.999, Math.max(0.001, p))

function metrics(rows, seasonsFilter) {
  let brier = 0
  let logLoss = 0
  let n = 0
  let correct = 0
  for (const r of rows) {
    if (!Number.isFinite(r.pHome)) continue
    if (seasonsFilter && !seasonsFilter.has(seasonYearOf(r.date))) continue
    const p = clamp(r.pHome)
    const y = r.hs > r.as ? 1 : 0
    brier += (p - y) ** 2
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p))
    if ((p >= 0.5 ? 1 : 0) === y) correct += 1
    n += 1
  }
  return n ? { n, brier: brier / n, logLoss: logLoss / n, acc: correct / n } : { n: 0 }
}

const fmt = (m) => `n=${String(m.n).padStart(5)}  Brier=${m.brier.toFixed(4)}  logLoss=${m.logLoss.toFixed(4)}  acc=${(m.acc * 100).toFixed(1)}%`

// --- корректировки ---
// mode:
//   'current'   — текущая логика: штраф фаворита за его extremeWin и за extremeLoss аутсайдера
//   'momentum'  — обратный знак: фавориту +k на extremeWin, аутсайдеру +k на extremeLoss (сильнее фаворит)
//   'underOnly' — только extremeLoss аутсайдера
//   'favOnly'   — только extremeWin фаворита
//   'linear'    — без порога EXTREME_MIN: m = 1 - k * max(0, len - 1) для длинных серий (непрерывно)
function adjust(rows, k, mode) {
  return rows.map((r) => {
    if (!Number.isFinite(r.pHome) || !Number.isFinite(r.pAway) || r.pHome === r.pAway) return r
    const favIsHome = r.pHome > r.pAway
    const fav = favIsHome ? r.home : r.away
    const under = favIsHome ? r.away : r.home
    const favStreak = streakOf(games, fav, r.date)
    const underStreak = streakOf(games, under, r.date)
    let m = 1
    if (mode === 'linear') {
      const s = favStreak?.type === 'win' ? favStreak : underStreak?.type === 'loss' ? underStreak : null
      if (s && s.length >= 2) m = 1 - k * (s.length - 1)
    } else if (mode === 'current') {
      if (favStreak?.isExtremeWin) m -= k
      if (underStreak?.isExtremeLoss) m -= k
    } else if (mode === 'momentum') {
      if (favStreak?.isExtremeWin) m += k
      if (underStreak?.isExtremeLoss) m += k
    } else if (mode === 'underOnly') {
      if (underStreak?.isExtremeLoss) m -= k
    } else if (mode === 'favOnly') {
      if (favStreak?.isExtremeWin) m -= k
    }
    m = Math.max(0.5, Math.min(1.5, m))
    const favP = (favIsHome ? r.pHome : r.pAway) * m
    const pHome = clamp(favIsHome ? favP : 1 - favP)
    return { ...r, pHome, pAway: clamp(1 - pHome) }
  })
}

// Парный t-тест по Brier: поэлементная разница (корректировка − база) на одних
// и тех же матчах. t = mean / (se / sqrt(n)); p — двухстороннее через нормальное
// приближение (n ~ 2.5–3 тысячи, приближение точное до 4 знаков).
function pairedTTest(baseRows, adjRows) {
  const diffs = []
  for (let i = 0; i < baseRows.length; i++) {
    const b = baseRows[i]
    const a = adjRows[i]
    if (!Number.isFinite(b.pHome) || !Number.isFinite(a.pHome)) continue
    const y = b.hs > b.as ? 1 : 0
    const pb = clamp(b.pHome)
    const pa = clamp(a.pHome)
    diffs.push((pa - y) ** 2 - (pb - y) ** 2)
  }
  const n = diffs.length
  const mean = diffs.reduce((s, d) => s + d, 0) / n
  const varr = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1)
  const se = Math.sqrt(varr / n)
  const t = se > 0 ? mean / se : 0
  const p = 2 * (1 - normalCdf(Math.abs(t)))
  return { n, mean, se, t, p }
}

function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2)
  const prob = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x >= 0 ? 1 - prob : prob
}

const baseRows = walkForward(games, teams, defaultModelConfig, advanced)
const seasons = [...new Set(baseRows.filter((r) => Number.isFinite(r.pHome)).map((r) => seasonYearOf(r.date)))].sort()
// Валидация — только последний сезон. Он может быть неполным (сбор данных
// оборван), поэтому n там в разы меньше общего — смотреть и dVal, и дельты.
const valSet = new Set([seasons[seasons.length - 1]])

console.log('Сезоны:', seasons.join(', '), '| валидация:', seasons[seasons.length - 1])
console.log('\n=== База (без серийных корректировок) ===')
console.log('все:      ', fmt(metrics(baseRows)))
console.log('валидация:', fmt(metrics(baseRows, valSet)))

console.log('\n=== Корректировки (k — величина шага) ===')
const modes = [
  ['current', [0.02, 0.03, 0.05, 0.06]],
  ['momentum', [0.02, 0.03, 0.05, 0.06]],
  ['underOnly', [0.02, 0.03, 0.05]],
  ['favOnly', [0.02, 0.03, 0.05]],
  ['linear', [0.01, 0.02, 0.03]],
]
const results = []
for (const [mode, ks] of modes) {
  for (const k of ks) {
    const rows = adjust(baseRows, k, mode)
    const all = metrics(rows)
    const val = metrics(rows, valSet)
    results.push({ mode, k, all, val, rows })
    console.log(
      `${(mode + ' k=' + k).padEnd(22)} все: ${fmt(all)}  |  вал: Brier=${val.brier.toFixed(4)} logLoss=${val.logLoss.toFixed(4)}`,
    )
  }
}

const base = metrics(baseRows)
const baseVal = metrics(baseRows, valSet)
console.log('\n=== Дельта к базе (все; отрицательное = лучше) ===')
for (const r of results) {
  const dB = r.all.brier - base.brier
  const dL = r.all.logLoss - base.logLoss
  const dVB = r.val.brier - baseVal.brier
  console.log(
    `${(r.mode + ' k=' + r.k).padEnd(22)} dBrier=${dB >= 0 ? '+' : ''}${dB.toFixed(4)}  dLogLoss=${dL >= 0 ? '+' : ''}${dL.toFixed(4)}  val dBrier=${dVB >= 0 ? '+' : ''}${dVB.toFixed(4)}`,
  )
}

console.log('\n=== Парный t-тест по Brier (корректировка − база, все матчи) ===')
console.log('|t| > 1.96 — значимо при α=0.05. Нужен ли вклад: если t < 0 и p < 0.05 — корректировка помогает.')
for (const r of results) {
  const { n, mean, se, t, p } = pairedTTest(baseRows, r.rows)
  console.log(
    `${(r.mode + ' k=' + r.k).padEnd(22)} n=${n}  mean=${mean >= 0 ? '+' : ''}${mean.toFixed(5)}  se=${se.toFixed(5)}  t=${t.toFixed(2)}  p=${p.toFixed(4)}`,
  )
}
