import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bankroll } from './components/Bankroll'
import { DataRefresh } from './components/DataRefresh'
import { MatchList, type ListRow } from './components/MatchList'
import { PredictionView } from './components/PredictionView'
import advancedRaw from './data/advanced.json'
import raw from './data/games.json'
import scheduleRaw from './data/schedule.json'
import updated from './data/updated.json'
import { advancedKey, buildRatings, predictMatch, walkForward, type AdvancedIndex } from './model/model'
import { blend, findMarket, oddsData } from './model/odds'
import type { Game, ScheduledGame, TeamInfo } from './types'
import { recentGames } from './utils/form'
import { readPicks, writePicks } from './utils/picks'
import { initialBank, initialConfidence, useSetting } from './utils/settings'

const dataset = raw as { generatedAt: string; teams: TeamInfo[]; games: Game[] }
const schedule = scheduleRaw as { generatedAt: string; games: ScheduledGame[] }

const advancedIndex: AdvancedIndex = {}
type AdvancedRow = {
  date: string
  home: string
  away: string
  h5g: number
  a5g: number
  h5c: number
  a5c: number
  h5x: number
  a5x: number
  hxa: number
  axa: number
}
for (const g of (advancedRaw as { games: AdvancedRow[] }).games) {
  advancedIndex[advancedKey(g.date, g.home, g.away)] = {
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

const TODAY = (() => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})()

// Уже сыгранные матчи (ключ «хозяева-гости-дата»). schedule.json может быть собран
// раньше, чем появился результат, поэтому такие пары исключаем из предстоящих.
const playedKeys = new Set<string>()
for (const g of dataset.games) playedKeys.add(`${g.home}-${g.away}-${g.date}`)

const UPCOMING_LIMIT = 15

// Ближайшие предстоящие матчи по календарю NHL (без уже сыгранных и дубликатов),
// по возрастанию даты. Общая логика для дефолтного матча и списка «Матч» — чтобы
// верх списка и матч по умолчанию не разъезжались.
function nearestUpcoming(): ScheduledGame[] {
  const seen = new Set<string>()
  const out: ScheduledGame[] = []
  for (const s of schedule.games) {
    if (s.date < TODAY) continue
    if (playedKeys.has(`${s.home}-${s.away}-${s.date}`)) continue
    const key = `${s.date}|${s.home}|${s.away}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, UPCOMING_LIMIT)
}

// Матч по умолчанию — верхний (новейший) в показываемом списке (ближайшие предстоящие
// + сыгранные), чтобы список при открытии начинался с самого свежего матча.
const DEFAULT_MATCH = (() => {
  const nearest = nearestUpcoming()
  const pool = nearest.length > 0 ? nearest : dataset.games
  if (pool.length === 0) return { home: '', away: '', date: TODAY }
  return pool.reduce((best, s) => (s.date > best.date ? s : best))
})()

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function latestDate(games: Game[]): string {
  return games.reduce((max, g) => (g.date > max ? g.date : max), '2020-01-01')
}

function marketFromOdds(homeOdd: string, awayOdd: string) {
  const h = Number(homeOdd)
  const a = Number(awayOdd)
  if (!(h > 1) || !(a > 1)) return null
  const rh = 1 / h
  const ra = 1 / a
  return { pHome: rh / (rh + ra), pAway: ra / (rh + ra) }
}

export default function App() {
  const teams = useMemo(() => [...dataset.teams].sort((a, b) => a.name.localeCompare(b.name)), [])
  const ratings = useMemo(() => buildRatings(dataset.games, dataset.teams, undefined, advancedIndex), [])
  const rows = useMemo(() => walkForward(dataset.games, dataset.teams, undefined, advancedIndex), [])
  const maxDate = useMemo(() => latestDate(dataset.games), [])
  const seasonStart = useMemo(() => {
    const [year, month] = TODAY.split('-').map(Number)
    const seasonYear = month >= 9 ? year : year - 1
    const prefix = `${seasonYear}-09-01`
    const dates = dataset.games.map((g) => g.date).filter((d) => d >= prefix)
    return dates.length ? dates.reduce((min, d) => (d < min ? d : min)) : maxDate
  }, [maxDate])

  const [home, setHome] = useState(DEFAULT_MATCH.home)
  const [away, setAway] = useState(DEFAULT_MATCH.away)
  const [date, setDate] = useState(DEFAULT_MATCH.date)
  const [weight, setWeight] = useState(0.5)
  const [oddsHome, setOddsHome] = useState('')
  const [oddsAway, setOddsAway] = useState('')
  const [bank, setBank] = useSetting(initialBank, 'bank')
  const [confidence, setConfidence] = useSetting(initialConfidence, 'conf')

  // Ссылка на панель управления (controls). Нужна, чтобы после выбора матча
  // можно было программно прокрутить страницу к прогнозу наверх.
  const topRef = useRef<HTMLDivElement>(null)

  // Кастомный выпадающий список «Матч». Нативный <select> браузер раскрывает сам и
  // позиционирует по-своему (верх списка мог не совпадать с выбранным), поэтому рисуем
  // свой список: всегда открывается сверху с самого свежего матча.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const pickerRef = useRef<HTMLDivElement>(null)
  const pickerButtonRef = useRef<HTMLDivElement>(null)
  const pickerListRef = useRef<HTMLUListElement>(null)

  // Закрываем список по клику вне него и по Escape (с возвратом фокуса на кнопку).
  useEffect(() => {
    if (!pickerOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPickerOpen(false)
        pickerButtonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pickerOpen])

  // По аббревиатуре команды (напр. "COL") возвращает её полное название.
  // useCallback — чтобы функция не пересоздавалась на каждый рендер.
  const nameOf = useCallback(
    (abbrev: string) => teams.find((t) => t.abbrev === abbrev)?.name ?? abbrev,
    [teams],
  )
  const sameTeam = Boolean(home && away && home === away)
  const prediction = useMemo(
    () => (home && away && !sameTeam ? predictMatch(ratings, home, away, date) : null),
    [ratings, home, away, date, sameTeam],
  )

  const manual = marketFromOdds(oddsHome, oddsAway)
  const auto = home && away ? findMarket(home, away, date) : null
  const market = manual
    ? { ...manual, source: 'ваши коэффициенты' }
    : auto && Number.isFinite(auto.pHome) && Number.isFinite(auto.pAway)
      ? {
          pHome: auto.pHome as number,
          pAway: auto.pAway as number,
          source: auto.books ? `${auto.books} БК · ${auto.date}` : `рынок · ${auto.date}`,
        }
      : null

  const blended =
    prediction && market
      ? {
          pHome: blend(prediction.pHomeFinal, market.pHome, weight),
          pAway: blend(prediction.pAwayFinal, market.pAway, weight),
        }
      : null

  const seasonRows = useMemo(
    () => rows.filter((r) => r.date >= seasonStart).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [rows, seasonStart],
  )

  // Сыгранные матчи каждой команды по убыванию даты — для «формы» в предстоящих матчах.
  const gamesByTeam = useMemo(() => {
    const map = new Map<string, Game[]>()
    for (const g of dataset.games) {
      for (const team of [g.home, g.away]) {
        const list = map.get(team)
        if (list) list.push(g)
        else map.set(team, [g])
      }
    }
    for (const list of map.values()) list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    return map
  }, [])

  // До n последних матчей команды строго до указанной даты (для «Ближайших»).
  const recentOf = useCallback(
    (team: string, date: string, n?: number): Game[] => recentGames(gamesByTeam, team, date, n),
    [gamesByTeam],
  )

  const upcoming = useMemo<ListRow[]>(() => {
    // Группируем по календарю NHL (schedule.json), а не по датам кэфов: у Oddsportal
    // дата сдвинута часовым поясом (Europe/Rome), и поздние матчи уезжают на сутки вперёд.
    return nearestUpcoming().map((s) => {
      const p = predictMatch(ratings, s.home, s.away, s.date)
      return {
        date: s.date,
        home: s.home,
        away: s.away,
        pHome: p.pHomeFinal,
        pAway: p.pAwayFinal,
      }
    })
  }, [ratings])

  const bets = useMemo(
    () =>
      upcoming.flatMap((u) => {
        const m = findMarket(u.home, u.away, u.date)
        if (!m || !m.oddsHome || !m.oddsAway || m.pHome === undefined || m.pAway === undefined) return []
        const p = predictMatch(ratings, u.home, u.away, u.date)
        const homeName = teams.find((t) => t.abbrev === u.home)?.name ?? u.home
        const awayName = teams.find((t) => t.abbrev === u.away)?.name ?? u.away
        return [
          {
            date: u.date,
            homeName,
            awayName,
            pModelH: p.pHomeFinal,
            pModelA: p.pAwayFinal,
            pMarketH: m.pHome,
            pMarketA: m.pAway,
            oddsHome: m.oddsHome,
            oddsAway: m.oddsAway,
          },
        ]
      }),
    [upcoming, ratings, teams],
  )

  const accuracy = useMemo(() => {
    const modelRows = rows.filter((r) => Number.isFinite(r.pHome))
    const modelCorrect = modelRows.filter(
      (r) => (r.pHome >= r.pAway ? 'home' : 'away') === (r.hs > r.as ? 'home' : 'away'),
    ).length

    const clamp = (p: number) => Math.min(0.999, Math.max(0.001, p))
    let modelBrier = 0
    let modelLogLoss = 0
    for (const r of modelRows) {
      const p = clamp(r.pHome)
      const y = r.hs > r.as ? 1 : 0
      modelBrier += (p - y) ** 2
      modelLogLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p))
    }
    modelBrier /= Math.max(1, modelRows.length)
    modelLogLoss /= Math.max(1, modelRows.length)

    const byTeams = new Map<string, Game[]>()
    for (const g of dataset.games) {
      const key = `${g.home}-${g.away}`
      const list = byTeams.get(key) ?? []
      list.push(g)
      byTeams.set(key, list)
    }
    let marketTotal = 0
    let marketCorrect = 0
    let marketBrier = 0
    let marketLogLoss = 0
    for (const o of oddsData) {
      const day = Date.parse(o.date)
      const game = (byTeams.get(`${o.home}-${o.away}`) ?? [])
        .map((g) => ({ g, d: Math.abs(Date.parse(g.date) - day) }))
        .filter((x) => x.d <= 86_400_000)
        .sort((a, b) => a.d - b.d)[0]?.g
      if (!game || o.pHome === undefined || o.pAway === undefined) continue
      marketTotal += 1
      const p = clamp(o.pHome)
      const y = game.hs > game.as ? 1 : 0
      if ((o.pHome >= o.pAway ? 'home' : 'away') === (game.hs > game.as ? 'home' : 'away')) marketCorrect += 1
      marketBrier += (p - y) ** 2
      marketLogLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p))
    }
    marketBrier /= Math.max(1, marketTotal)
    marketLogLoss /= Math.max(1, marketTotal)
    return {
      modelTotal: modelRows.length,
      modelCorrect,
      modelBrier,
      modelLogLoss,
      marketTotal,
      marketCorrect,
      marketBrier,
      marketLogLoss,
    }
  }, [rows])

  const marketOf = useCallback((h: string, a: string, d: string) => {
    const m = findMarket(h, a, d)
    if (!m) return null
    const hasOutcome = Number.isFinite(m.pHome) && Number.isFinite(m.pAway)
    const hasTotal = Number.isFinite(m.pOverMarket)
    if (!hasOutcome && !hasTotal) return null
    return {
      pHome: hasOutcome ? (m.pHome as number) : undefined,
      pAway: hasOutcome ? (m.pAway as number) : undefined,
      pOver: hasTotal ? m.pOverMarket : undefined,
    }
  }, [])

  // «Суперматч дня» (рамка + ★). В предстоящих считается каждый раз; когда матч
  // становится прошедшим, выбор берётся из сохранённого — рамка «переезжает».
  const [initialPicks] = useState(readPicks)
  const picks = useMemo(() => {
    const next: Record<string, string> = { ...initialPicks }
    const bestOfDay = (list: ListRow[], date: string): string | null => {
      let best: string | null = null
      let bestProb = -1
      for (const r of list) {
        if (r.date !== date) continue
        if (!Number.isFinite(r.pHome) || !Number.isFinite(r.pAway)) continue
        const m = marketOf(r.home, r.away, r.date)
        if (!m || !Number.isFinite(m.pHome) || !Number.isFinite(m.pAway)) continue
        const modelFav = (r.pHome as number) >= (r.pAway as number) ? 'home' : 'away'
        const marketFav = (m.pHome as number) >= (m.pAway as number) ? 'home' : 'away'
        if (modelFav !== marketFav) continue
        const p = Math.max(r.pHome as number, (r.pAway ?? 0) as number)
        if (Math.round(p * 100) >= confidence && p > bestProb) {
          bestProb = p
          best = `${r.home}-${r.away}`
        }
      }
      return best
    }

    for (const date of new Set(upcoming.map((u) => u.date))) {
      const key = bestOfDay(upcoming, date)
      if (key) next[date] = key
      else delete next[date]
    }
    for (const date of new Set(seasonRows.map((r) => r.date))) {
      if (next[date]) continue
      const key = bestOfDay(seasonRows, date)
      if (key) next[date] = key
    }
    return next
  }, [upcoming, seasonRows, marketOf, confidence, initialPicks])

  useEffect(() => {
    writePicks(picks)
  }, [picks])

  const bestOf = useCallback((date: string) => picks[date] ?? null, [picks])

  // Выбор матча одной операцией: задаёт хозяев, гостей и дату, а затем
  // плавно прокручивает страницу к панели прогноза (наверх).
  const select = useCallback((h: string, a: string, d: string) => {
    setHome(h)
    setAway(a)
    setDate(d)
    const el = topRef.current
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // Список готовых пар «дата · команда — команда» для выпадающего селектора.
  // Берём предстоящие матчи и сыгранные текущего сезона; дубликаты отсекаем.
  // value = "дата|хозяева|гости" — по нему потом разбираем выбор.
  const matchOptions = useMemo(() => {
    const seen = new Set<string>() // уже добавленные ключи, чтобы не дублировать
    const opts: Array<{ value: string; label: string; date: string }> = []
    const push = (d: string, h: string, a: string) => {
      const key = `${d}|${h}|${a}`
      if (seen.has(key)) return
      seen.add(key)
      opts.push({ value: key, label: `${d} · ${nameOf(h)} — ${nameOf(a)}`, date: d })
    }
    for (const u of upcoming) push(u.date, u.home, u.away) // предстоящие
    for (const r of seasonRows) push(r.date, r.home, r.away) // сыгранные сезона
    // Сортировка по убыванию дат — от поздних к ранним, чтобы список не «прыгал».
    return opts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }, [upcoming, seasonRows, nameOf])

  // Ключ текущего выбранного матча, например "2026-10-08|CAR|VAN".
  const currentKey = `${date}|${home}|${away}`

  // Варианты для селектора «Матч». Если текущий выбранный матч отсутствует в общем
  // списке (например, выбран вручную через селекторы команд), добавляем его — но
  // вставляем по дате, чтобы не ломать сортировку по убыванию, — селектор всё равно
  // отображает текущий выбор.
  const pickerOptions = useMemo(() => {
    if (home && away && !matchOptions.some((o) => o.value === currentKey)) {
      const manual = { value: currentKey, label: `${date} · ${nameOf(home)} — ${nameOf(away)}`, date }
      return [...matchOptions, manual].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    }
    return matchOptions
  }, [matchOptions, currentKey, date, home, away, nameOf])

  // Значение селектора: текущий матч (или пусто, если команды не заданы).
  const pickerValue = home && away ? currentKey : ''

  // Текст на кнопке селектора: подпись текущего матча (или плейсхолдер).
  const pickerLabel = pickerOptions.find((o) => o.value === pickerValue)?.label ?? '— выберите матч —'

  // Выбор матча из списка: разбираем "дата|хозяева|гости", прокручиваем наверх и
  // возвращаем фокус на кнопку, чтобы управление с клавиатуры не терялось.
  const chooseOption = (value: string | undefined) => {
    if (!value) return
    const [d, h, a] = value.split('|')
    if (d && h && a) select(h, a, d)
    setPickerOpen(false)
    pickerButtonRef.current?.focus()
  }

  // Открытие списка: всегда начинаем сверху (с самого свежего матча) и ставим фокус
  // на контрол, чтобы работала навигация с клавиатуры.
  const openPicker = () => {
    setActiveIndex(0)
    setPickerOpen(true)
    pickerButtonRef.current?.focus()
  }

  // Держим активный (подсвеченный) пункт в зоне видимости при навигации с клавиатуры.
  useEffect(() => {
    if (!pickerOpen) return
    const el = pickerListRef.current?.children[activeIndex] as HTMLElement | undefined
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [pickerOpen, activeIndex])

  const confidentRows = seasonRows.filter(
    (r) =>
      Number.isFinite(r.pHome) &&
      Number.isFinite(r.pAway) &&
      Math.round(Math.max(r.pHome, r.pAway) * 100) >= confidence,
  )
  const confidentCorrect = confidentRows.filter(
    (r) => (r.pHome >= r.pAway ? 'home' : 'away') === (r.hs > r.as ? 'home' : 'away'),
  ).length

  return (
    <div className="app">
      <header>
        <h1>Hockey — прогноз матчей NHL</h1>
        <p className="caption">
          Данные: {dataset.games.length} матчей, {dataset.teams.length} команд · обновлено{' '}
          {updated.updatedAt ? formatDateTime(updated.updatedAt) : '—'}
        </p>
      </header>

      <DataRefresh />

      <div className="controls" ref={topRef}>
        <div className="match-picker" ref={pickerRef}>
          <span id="match-picker-title">Матч (выбрать пару)</span>
          {/* Контрол-комбобокс (APG select-only): показывает текущий матч и синхронизирован
              с остальными полями. Список рисуем сами: при раскрытии он всегда начинается
              сверху, с самого свежего матча. При выборе разбираем "дата|хозяева|гости"
              и вызываем select(). Роль combobox (а не button) — чтобы aria-activedescendant
              корректно объявлял активный пункт скринридеру. */}
          <div
            ref={pickerButtonRef}
            id="match-picker-btn"
            role="combobox"
            tabIndex={0}
            className="picker-button"
            aria-haspopup="listbox"
            aria-autocomplete="none"
            aria-controls={pickerOpen ? 'match-picker-list' : undefined}
            aria-expanded={pickerOpen}
            aria-labelledby="match-picker-title"
            aria-activedescendant={
              pickerOpen && pickerOptions.length > 0 ? `match-picker-opt-${activeIndex}` : undefined
            }
            onClick={() => (pickerOpen ? setPickerOpen(false) : openPicker())}
            onKeyDown={(e) => {
              const last = pickerOptions.length - 1
              if (!pickerOpen) {
                // Открываем список с клавиатуры.
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openPicker()
                }
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActiveIndex((i) => Math.min(i + 1, Math.max(last, 0)))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActiveIndex((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Home') {
                e.preventDefault()
                setActiveIndex(0)
              } else if (e.key === 'End') {
                e.preventDefault()
                setActiveIndex(Math.max(last, 0))
              } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                chooseOption(pickerOptions[activeIndex]?.value)
              } else if (e.key === 'Tab') {
                setPickerOpen(false)
              }
            }}
          >
            <span className="picker-value">{pickerLabel}</span>
            <span className="picker-caret" aria-hidden="true">
              ▾
            </span>
          </div>
          {pickerOpen && (
            <ul className="picker-list" id="match-picker-list" role="listbox" aria-label="Матчи" ref={pickerListRef}>
              {pickerOptions.map((o, i) => (
                <li
                  key={o.value}
                  id={`match-picker-opt-${i}`}
                  role="option"
                  aria-selected={o.value === pickerValue}
                  className={`picker-option${i === activeIndex ? ' active' : ''}${
                    o.value === pickerValue ? ' selected' : ''
                  }`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => chooseOption(o.value)}
                >
                  {o.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <label>
          Хозяева
          <select value={home} onChange={(e) => setHome(e.target.value)}>
            {teams.map((t) => (
              <option key={t.abbrev} value={t.abbrev}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Гости
          <select value={away} onChange={(e) => setAway(e.target.value)}>
            {teams.map((t) => (
              <option key={t.abbrev} value={t.abbrev}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Дата
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Кэф хозяев (необяз.)
          <input value={oddsHome} onChange={(e) => setOddsHome(e.target.value)} placeholder="1.85" />
        </label>
        <label>
          Кэф гостей (необяз.)
          <input value={oddsAway} onChange={(e) => setOddsAway(e.target.value)} placeholder="2.10" />
        </label>
      </div>

      {sameTeam && <p className="error">Выберите две разные команды</p>}

      {prediction && (
        <PredictionView
          homeName={nameOf(home)}
          awayName={nameOf(away)}
          prediction={prediction}
          market={market}
          blended={blended}
          weight={weight}
          onWeight={setWeight}
          note={
            date < maxDate
              ? 'Для прошедшей даты показаны рейтинги на последнюю дату данных, а не walk-forward. Честный прогноз на этот день — в списке «Матчи на…».'
              : undefined
          }
        />
      )}

      <section className="matches">
        <h2>Точность: модель и рынок</h2>
        <div className="grid">
          <div>
            <span className="label">Модель · все матчи</span>
            <strong>
              {((accuracy.modelCorrect / Math.max(1, accuracy.modelTotal)) * 100).toFixed(1)}% ({accuracy.modelCorrect}/{accuracy.modelTotal})
            </strong>
          </div>
          <div>
            <span className="label">Рынок · матчи с кэфами</span>
            <strong>
              {accuracy.marketTotal
                ? `${((accuracy.marketCorrect / accuracy.marketTotal) * 100).toFixed(1)}% (${accuracy.marketCorrect}/${accuracy.marketTotal})`
                : 'нет данных'}
            </strong>
          </div>
          <div>
            <span className="label">Brier · модель (меньше = лучше)</span>
            <strong>{accuracy.modelBrier.toFixed(3)}</strong>
          </div>
          <div>
            <span className="label">Brier · рынок</span>
            <strong>{accuracy.marketTotal ? accuracy.marketBrier.toFixed(3) : '—'}</strong>
          </div>
          <div>
            <span className="label">Log-loss · модель</span>
            <strong>{accuracy.modelLogLoss.toFixed(3)}</strong>
          </div>
          <div>
            <span className="label">Log-loss · рынок</span>
            <strong>{accuracy.marketTotal ? accuracy.marketLogLoss.toFixed(3) : '—'}</strong>
          </div>
        </div>
        <p className="caption">
          Модель — walk-forward (только по прошлым матчам). Рынок — по собранным кэфам, где есть результат.
        </p>
      </section>

      <MatchList
        title={`Матчи текущего сезона (с ${seasonStart})`}
        rows={seasonRows}
        nameOf={nameOf}
        marketOf={marketOf}
        onSelect={select}
        emptyText="Нет сыгранных матчей текущего сезона."
        fullDate
        collapsibleDays
        bestOf={bestOf}
        minConfidence={confidence / 100}
      />
      {confidentRows.length > 0 && (
        <p className="caption summary">
          Среди матчей с уверенностью модели {confidence}% и выше исход угадан в {confidentCorrect} из{' '}
          {confidentRows.length} ({Math.round((confidentCorrect / confidentRows.length) * 100)}%). Раскрой матч,
          чтобы увидеть детали.
        </p>
      )}

      <p className="caption">
        Красная рамка ★ — самый уверенный матч игрового дня: модель и рынок согласны на фаворите, а уверенность
        модели не ниже порога (по умолчанию 65%). Порог регулируется ползунком «Уверенность модели для
        красной рамки» в «Дополнительных настройках» внизу. В «Ближайших» рамка считается заново, а когда матч
        становится сыгранным — сохраняется за ним, чтобы видеть, угадан ли прогноз на «суперматч».
      </p>

      <MatchList
        title="Ближайшие матчи"
        rows={upcoming}
        nameOf={nameOf}
        marketOf={marketOf}
        onSelect={select}
        emptyText="Нет предстоящих матчей."
        bestOf={bestOf}
        minConfidence={confidence / 100}
        recentOf={recentOf}
      />

      <Bankroll bets={bets} bank={bank} onBank={setBank} day={TODAY} minConfidence={confidence} onMinConfidence={setConfidence} />
    </div>
  )
}
