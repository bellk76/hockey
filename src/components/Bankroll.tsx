import { useMemo } from 'react'
import {
  initialAgree,
  initialBasis,
  initialMinProb,
  initialMode,
  initialOddsMax,
  initialOddsMin,
  initialRisk,
  initialThreshold,
  useSetting,
} from '../utils/settings'

interface Bet {
  date: string
  homeName: string
  awayName: string
  pModelH: number
  pModelA: number
  pMarketH: number
  pMarketA: number
  oddsHome: number
  oddsAway: number
}

interface BankrollProps {
  bets: Bet[]
  bank: number
  onBank: (value: number) => void
  day: string
  minConfidence: number
  onMinConfidence: (value: number) => void
}

const MAX_STAKE_SHARE = 0.1
const MIN_STAKE = 50
const BANK_PRESETS = [1000, 3000, 5000, 10000]

interface Candidate {
  match: string
  side: string
  odds: number
  pBasis: number
  pModel: number
  pMarket: number
  ev: number
}

interface Stake extends Candidate {
  stake: number
  share: number
}

interface Filters {
  minProb: number
  agree: boolean
  oddsMin: number
  oddsMax: number
}

function buildCandidates(bets: Bet[], basis: number, threshold: number, filters: Filters): Candidate[] {
  const rows: Candidate[] = []
  for (const b of bets) {
    const sides = [
      { side: `Победа: ${b.homeName}`, pModel: b.pModelH, pMarket: b.pMarketH, odds: b.oddsHome },
      { side: `Победа: ${b.awayName}`, pModel: b.pModelA, pMarket: b.pMarketA, odds: b.oddsAway },
    ]
    let best: Candidate | null = null
    for (const s of sides) {
      if (!(s.odds > 1)) continue
      if (!Number.isFinite(s.pMarket) || s.pMarket <= 0 || s.pMarket > 1) continue
      if (!Number.isFinite(s.pModel) || s.pModel < 0 || s.pModel > 1) continue
      if (s.pModel < filters.minProb) continue
      if (filters.agree && !(s.pModel >= 0.5 && s.pMarket >= 0.5)) continue
      if (s.odds < filters.oddsMin || s.odds > filters.oddsMax) continue
      const pBasis = basis * s.pMarket + (1 - basis) * s.pModel
      const ev = pBasis * s.odds - 1
      if (!Number.isFinite(ev) || ev < threshold) continue
      const candidate: Candidate = {
        match: `${b.homeName} — ${b.awayName}`,
        side: s.side,
        odds: s.odds,
        pBasis,
        pModel: s.pModel,
        pMarket: s.pMarket,
        ev,
      }
      if (!best || ev > best.ev) best = candidate
    }
    if (best) rows.push(best)
  }
  return rows.sort((a, b) => b.ev - a.ev)
}

interface SideInfo {
  side: string
  odds: number
  pModel: number
  pMarket: number
  pBasis: number
  ev: number
}

function bestSide(b: Bet, basis: number): SideInfo | null {
  const sides = [
    { side: `Победа: ${b.homeName}`, pModel: b.pModelH, pMarket: b.pMarketH, odds: b.oddsHome },
    { side: `Победа: ${b.awayName}`, pModel: b.pModelA, pMarket: b.pMarketA, odds: b.oddsAway },
  ]
    .filter(
      (s) =>
        Number.isFinite(s.odds) &&
        s.odds > 1 &&
        Number.isFinite(s.pMarket) &&
        s.pMarket > 0 &&
        s.pMarket <= 1 &&
        Number.isFinite(s.pModel) &&
        s.pModel >= 0 &&
        s.pModel <= 1,
    )
    .map((s) => {
      const pBasis = basis * s.pMarket + (1 - basis) * s.pModel
      return { ...s, pBasis, ev: pBasis * s.odds - 1 }
    })
  if (sides.length === 0) return null
  return sides.sort((a, b2) => b2.ev - a.ev)[0]
}

function kellyStakes(candidates: Candidate[], bank: number): Stake[] {
  return candidates
    .map((c) => {
      const kelly = (c.pBasis * c.odds - 1) / (c.odds - 1)
      const share = Math.min(kelly, MAX_STAKE_SHARE)
      return { ...c, share, stake: Math.round(bank * share) }
    })
    .filter((s) => s.stake >= MIN_STAKE)
}

function spreadStakes(candidates: Candidate[], budget: number): Stake[] {
  if (candidates.length === 0) return []
  const maxCount = Math.floor(budget / MIN_STAKE)
  if (maxCount === 0) return []
  const chosen = [...candidates].sort((a, b) => b.ev - a.ev).slice(0, maxCount)
  const per = Math.floor(budget / chosen.length)
  if (per < MIN_STAKE) return []
  return chosen.map((c) => ({ ...c, share: per / budget, stake: per }))
}

function capTotal(stakes: Stake[], budget: number): Stake[] {
  const total = stakes.reduce((sum, s) => sum + s.stake, 0)
  if (total <= budget || total === 0) return stakes
  const k = budget / total
  return stakes.map((s) => ({ ...s, stake: Math.round(s.stake * k) }))
}

function profitStats(stakes: Stake[]) {
  let dist = new Map<number, number>([[0, 1]])
  for (const s of stakes) {
    const win = s.stake * (s.odds - 1)
    const lose = -s.stake
    const next = new Map<number, number>()
    for (const [value, prob] of dist) {
      const w = value + win
      const l = value + lose
      next.set(w, (next.get(w) ?? 0) + prob * s.pBasis)
      next.set(l, (next.get(l) ?? 0) + prob * (1 - s.pBasis))
    }
    dist = next
  }
  let mean = 0
  let variance = 0
  let pProfit = 0
  for (const [value, prob] of dist) {
    mean += value * prob
    variance += value * value * prob
    if (value > 0) pProfit += prob
  }
  variance -= mean * mean
  return { mean, std: Math.sqrt(Math.max(0, variance)), pProfit }
}

interface Allocation {
  stakes: Stake[]
  pProfit: number
  mean: number
  std: number
}

function maxProbabilityAllocation(candidates: Candidate[], bank: number): Allocation | null {
  const k = candidates.length
  // Полный перебор подмножеств — O(3^k). Ограничиваем, чтобы не морозить UI.
  if (k === 0 || k > 12) return null
  let best: Allocation | null = null
  for (let mask = 1; mask < 1 << k; mask += 1) {
    const subset: Candidate[] = []
    for (let i = 0; i < k; i += 1) if (mask & (1 << i)) subset.push(candidates[i])
    const per = Math.floor(bank / subset.length)
    if (per < MIN_STAKE) continue
    const stakes: Stake[] = subset.map((c) => ({ ...c, share: per / bank, stake: per }))
    const stats = profitStats(stakes)
    if (
      !best ||
      stats.pProfit > best.pProfit ||
      (Math.abs(stats.pProfit - best.pProfit) < 1e-9 && stats.mean > best.mean)
    ) {
      best = { stakes, pProfit: stats.pProfit, mean: stats.mean, std: stats.std }
    }
  }
  return best
}

export function Bankroll({ bets, bank, onBank, day, minConfidence, onMinConfidence }: BankrollProps) {
  const [basis, setBasis] = useSetting(initialBasis, 'basis2')
  const [threshold, setThreshold] = useSetting(initialThreshold, 'ev2')
  const [mode, setMode] = useSetting(initialMode, 'mode2')

  const [risk, setRisk] = useSetting(initialRisk, 'risk')
  const [minProb, setMinProb] = useSetting(initialMinProb, 'minProb')
  const [agree, setAgree] = useSetting(initialAgree, 'agree')
  const [oddsMin, setOddsMin] = useSetting(initialOddsMin, 'oddsMin2')
  const [oddsMax, setOddsMax] = useSetting(initialOddsMax, 'oddsMax2')

  const derived = useMemo(() => {
    const dayB = bets.filter((b) => b.date === day)
    const cands = buildCandidates(dayB, basis, threshold / 100, {
      minProb: minProb / 100,
      agree: agree === 1,
      oddsMin,
      oddsMax,
    })
    const bud = Math.round((bank * risk) / 100)
    const kelly = capTotal(kellyStakes(cands, bud), bud).filter((s) => s.stake >= MIN_STAKE)
    const maxProb = (maxProbabilityAllocation(cands, bud)?.stakes ?? []).filter((s) => s.stake >= MIN_STAKE)
    const spread = spreadStakes(cands, bud).filter((s) => s.stake >= MIN_STAKE)
    const comp = [
      { name: 'Максимум вероятности плюса', stakes: maxProb },
      { name: 'Размазать по всем подходящим', stakes: spread },
      { name: 'Келли (рост банка)', stakes: kelly },
    ].map((c) => ({
      ...c,
      stats: profitStats(c.stakes),
      total: c.stakes.reduce((sum, s) => sum + s.stake, 0),
    }))
    const r = Math.max(0.01, risk / 100)
    const shares = cands.map((c) => Math.min((c.pBasis * c.odds - 1) / (c.odds - 1), MAX_STAKE_SHARE))
    const scale = Math.max(1, shares.reduce((s, v) => s + v, 0))
    const bankFor = (share: number) => (share > 0 ? Math.ceil((MIN_STAKE * scale) / (r * share)) : 0)
    return {
      dayBets: dayB,
      candidates: cands,
      budget: bud,
      kellyAlloc: kelly,
      maxProbAlloc: maxProb,
      spreadAlloc: spread,
      comparison: comp,
      minBankOne: shares.length ? bankFor(Math.max(...shares)) : 0,
      minBankAll: shares.length ? bankFor(Math.min(...shares)) : 0,
    }
  }, [bets, day, basis, threshold, bank, risk, minProb, agree, oddsMin, oddsMax])

  const {
    dayBets,
    candidates,
    budget,
    kellyAlloc,
    maxProbAlloc,
    spreadAlloc,
    comparison,
    minBankOne,
    minBankAll,
  } = derived
  const activeStakes = mode === 0 ? kellyAlloc : mode === 1 ? maxProbAlloc : spreadAlloc
  const activeStats = profitStats(activeStakes)

  const stakeByMatch = new Map(activeStakes.map((s) => [s.match, s.stake]))
  const totalStake = activeStakes.reduce((sum, s) => sum + s.stake, 0)
  const expectedReturn = activeStakes.reduce((sum, s) => sum + s.pBasis * s.odds * s.stake, 0)
  const expectedProfit = expectedReturn - totalStake

  return (
    <section className="matches">
      <h2>Распределение банка на {day}</h2>

      <label className="bank-input">
        Банк, ₽
        <input
          type="number"
          min={0}
          value={bank}
          onChange={(e) => onBank(Math.max(0, Number(e.target.value)))}
        />
      </label>

      <div className="presets">
        {BANK_PRESETS.map((value) => (
          <button
            type="button"
            key={value}
            className={bank === value ? 'chip active' : 'chip'}
            onClick={() => onBank(value)}
          >
            {value} ₽
          </button>
        ))}
      </div>

      <label className="kelly">
        Стратегия
        <select value={mode} onChange={(e) => setMode(Number(e.target.value))}>
          <option value={0}>Келли — максимум роста на дистанции</option>
          <option value={1}>Максимум вероятности выйти в плюс за день</option>
          <option value={2}>Размазать равномерно по всем подходящим</option>
        </select>
      </label>

      <div className="weight">
        <label>
          Максимум риска за день: {risk}% банка ({budget} ₽)
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={risk}
            onChange={(e) => setRisk(Number(e.target.value))}
          />
        </label>
      </div>

      {dayBets.length > 0 && (
        <p className="caption">Купон на день: матч → исход (победа с учётом ОТ/буллитов) и сумма ставки</p>
      )}
      {dayBets.map((b) => {
        const info = bestSide(b, basis)
        if (!info) return null
        const match = `${b.homeName} — ${b.awayName}`
        const stake = stakeByMatch.get(match)
        return (
          <div className="bet" key={match}>
            <span className="bet-match">
              {stake ? (
                <>
                  {match} → <b className="bet-stake">{info.side}</b>
                </>
              ) : (
                match
              )}
            </span>
            <span className="match-meta">
              <span>кэф {info.odds.toFixed(2)}</span>
              <span>
                модель {(info.pModel * 100).toFixed(0)}% / рынок {(info.pMarket * 100).toFixed(0)}%
              </span>
              <span className={info.ev > 0 ? 'ok' : 'bad'}>EV {(info.ev * 100).toFixed(1)}%</span>
              <span className={stake ? 'bet-stake' : 'skip'}>{stake ? `${stake} ₽` : 'нет ставки'}</span>
            </span>
          </div>
        )
      })}

      {candidates.length === 0 && (
        <p className="caption">
          Нет ставок, проходящих фильтры (EV, мин. вероятность модели, согласие с рынком, диапазон кэфов).
          Ослабь фильтры в «Дополнительных настройках».
        </p>
      )}

      {candidates.length > 0 && mode === 0 && (
        <>
          <p className="caption min-bank">
            Минимальный банк: <b>{minBankOne} ₽</b> — чтобы прошла одна ставка; <b>{minBankAll} ₽</b> — чтобы
            прошли все {candidates.length} (минимум букмекера 50 ₽).
          </p>
          <div className="presets">
            <button type="button" className="chip" onClick={() => onBank(minBankOne)}>
              Банк = {minBankOne} ₽ (1 ставка)
            </button>
            <button type="button" className="chip" onClick={() => onBank(minBankAll)}>
              Банк = {minBankAll} ₽ (все {candidates.length})
            </button>
          </div>
        </>
      )}

      {activeStakes.length === 0 && candidates.length > 0 && (
        <p className="caption">
          При банке {bank} ₽ и выбранной стратегии ставки не проходят минимум 50 ₽. Увеличь банк или подними
          порог EV.
        </p>
      )}

      {activeStakes.length > 0 && activeStats && (
        <div className="grid">
          <div>
            <span className="label">Всего поставлено</span>
            <strong>{totalStake} ₽</strong>
          </div>
          <div>
            <span className="label">Ставок</span>
            <strong>{activeStakes.length}</strong>
          </div>
          <div>
            <span className="label">Ожидаемая прибыль</span>
            <strong className={expectedProfit >= 0 ? 'ok' : 'bad'}>
              {expectedProfit >= 0 ? '+' : ''}
              {expectedProfit.toFixed(0)} ₽
            </strong>
          </div>
          <div>
            <span className="label">Вероятность выйти в плюс</span>
            <strong className={activeStats.pProfit >= 0.5 ? 'ok' : 'bad'}>
              {(activeStats.pProfit * 100).toFixed(0)}%
            </strong>
          </div>
          <div>
            <span className="label">Разброс, ±</span>
            <strong>{activeStats.std.toFixed(0)} ₽</strong>
          </div>
        </div>
      )}

      {candidates.length > 0 && (
        <section className="compare">
          <p className="row-label">Сравнение стратегий за день</p>
          {comparison.map((c) => (
            <div className="compare-row" key={c.name}>
              <span className="compare-name">{c.name}</span>
              <span className="match-meta">
                <span>ставок {c.stakes.length}</span>
                <span>поставлено {c.total} ₽</span>
                <span>
                  ожидание {c.stats.mean >= 0 ? '+' : ''}
                  {c.stats.mean.toFixed(0)} ₽
                </span>
                <span className={c.stats.pProfit >= 0.5 ? 'ok' : 'bad'}>
                  вероятность плюса {(c.stats.pProfit * 100).toFixed(0)}%
                </span>
              </span>
            </div>
          ))}
        </section>
      )}

      <details className="advanced">
        <summary>Дополнительные настройки</summary>
        <div className="weight">
          <label>
            Основа расчёта: {Math.round((1 - basis) * 100)}% модель / {Math.round(basis * 100)}% рынок
            <input
              type="range"
              min={0}
              max={100}
              step={25}
              value={basis * 100}
              onChange={(e) => setBasis(Number(e.target.value) / 100)}
            />
          </label>
        </div>
        <div className="weight">
          <label>
            Порог EV: {threshold}% (ставим только на это значение и выше)
            <input
              type="range"
              min={0}
              max={30}
              step={1}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="weight">
          <label>
            Мин. вероятность модели: {minProb}%
            <input
              type="range"
              min={0}
              max={60}
              step={5}
              value={minProb}
              onChange={(e) => setMinProb(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="weight">
          <label>
            Уверенность модели для красной рамки: {minConfidence}% (от этого значения)
            <input
              type="range"
              min={0}
              max={90}
              step={1}
              value={minConfidence}
              onChange={(e) => onMinConfidence(Number(e.target.value))}
            />
          </label>
        </div>
        <label className="kelly">
          <input
            type="checkbox"
            checked={agree === 1}
            onChange={(e) => setAgree(e.target.checked ? 1 : 0)}
          />
          Только при согласии с рынком (оба считают фаворитом одну команду)
        </label>
        <div className="kelly">
          <label>
            Кэф от
            <input type="number" step={0.1} value={oddsMin} onChange={(e) => setOddsMin(Number(e.target.value))} />
          </label>
          <label>
            до
            <input type="number" step={0.1} value={oddsMax} onChange={(e) => setOddsMax(Number(e.target.value))} />
          </label>
        </div>
      </details>

      <p className="caption">
        «Келли» максимизирует рост банка на длинной дистанции. «Максимум вероятности плюса» перебирает наборы
        ставок с равными долями и выбирает тот, где чаще выходит плюс по итогу дня — но у него может быть
        меньшее (и даже отрицательное) ожидание. Ставки — риск; это оценка, а не гарантия. Кэфы реальные (с
        маржой), минимум 50 ₽ — ограничение букмекера.
      </p>
    </section>
  )
}
