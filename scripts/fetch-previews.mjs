// Предыгровое превью: кто вне состава (травмы) у команд ближайших матчей.
// Источник — Daily Faceoff (страницы команд, раздел Injuries). Forward-only:
// истории нет, данные — только про предстоящие матчи из schedule.json.
// Результат — src/data/previews.json.
//
// Запуск: node scripts/fetch-previews.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://www.dailyfaceoff.com'
const NHL_BASE = 'https://api-web.nhle.com/v1'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const here = dirname(fileURLToPath(import.meta.url))
const GAMES = join(here, '..', 'src', 'data', 'games.json')
const SCHEDULE = join(here, '..', 'src', 'data', 'schedule.json')
const OUT = join(here, '..', 'src', 'data', 'previews.json')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getText(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(15000) })
      if (res.ok) return res.text()
      if (res.status === 404) return null
    } catch {
      /* повтор */
    }
    await sleep(400 * attempt)
  }
  return null
}

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
      if (res.ok) return res.json()
      if (res.status === 404) return null
    } catch {
      /* повтор */
    }
    await sleep(400 * attempt)
  }
  return null
}

const STATUS = {
  ir: 'травмирован',
  ltir: 'долгосрочная травма',
  out: 'вне состава',
  dtd: 'под вопросом',
  'day-to-day': 'под вопросом',
}

function slugOf(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function decodeEntities(s) {
  return s
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function normalizeName(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

// Имена вратарей команды (для пометки «вратарь» у травмированных) — из roster NHL.
async function goalieNames(abbrev, season) {
  const r = await getJson(`${NHL_BASE}/roster/${abbrev}/${season}`)
  const set = new Set()
  for (const g of r?.goalies ?? []) {
    set.add(normalizeName(`${g.firstName?.default ?? ''} ${g.lastName?.default ?? ''}`))
  }
  return set
}

function parseInjuries(html) {
  const idx = html.indexOf('text-white">Injuries</span>')
  if (idx < 0) return []
  const section = html.slice(idx)
  const out = []
  // Разбиваем на карточки; учитываем только те, где есть бейдж статуса (bg-red-500),
  // чтобы не захватить футер (DFO/PuckPedia и т.п.).
  const cards = section.split('<div class="w-1/3 text-center">').slice(1)
  for (const card of cards) {
    const badge = card.match(/bg-red-500[^>]*>([a-z-]+)<\/span>/)
    if (!badge) continue
    const code = badge[1]
    if (!code || code === 'none') continue
    const alt = card.match(/<img alt="([^"]+)"/)
    if (!alt) continue
    out.push({ name: decodeEntities(alt[1]), status: STATUS[code] ?? code })
  }
  return out
}

const dataset = JSON.parse(readFileSync(GAMES, 'utf8'))
const schedule = JSON.parse(readFileSync(SCHEDULE, 'utf8'))
const nameByAbbrev = new Map(dataset.teams.map((t) => [t.abbrev, t.name]))

const now = new Date()
const seasonYear = now.getUTCMonth() + 1 >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
const season = `${seasonYear}${seasonYear + 1}`

const teams = [...new Set(schedule.games.flatMap((g) => [g.home, g.away]))]

const previews = {}
let fetched = 0
for (const abbrev of teams) {
  const name = nameByAbbrev.get(abbrev)
  if (!name) continue
  const slug = slugOf(name)
  const [html, goalies] = await Promise.all([
    getText(`${BASE}/teams/${slug}/line-combinations`),
    goalieNames(abbrev, season),
  ])
  if (html) fetched += 1
  const injuries = (html ? parseInjuries(html) : []).map((i) => ({
    ...i,
    pos: goalies.has(normalizeName(i.name)) ? 'G' : undefined,
  }))
  previews[abbrev] = { name, injuries }
  console.log(`${abbrev} (${name}): ${injuries.length ? injuries.map((i) => `${i.name}[${i.status}${i.pos === 'G' ? ', вратарь' : ''}]`).join(', ') : 'нет травм'}`)
  await sleep(250)
}

if (fetched === 0) {
  console.error(`Не удалось получить ни одной страницы Daily Faceoff — файл ${OUT} НЕ перезаписан.`)
  process.exit(1)
}
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), teams: previews }, null, 2))
console.log(`\n-> ${OUT}`)
