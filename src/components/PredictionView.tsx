import type { Prediction } from '../types'

interface Market {
  pHome: number
  pAway: number
  source: string
}

interface Blend {
  pHome: number
  pAway: number
}

interface PredictionViewProps {
  homeName: string
  awayName: string
  prediction: Prediction
  market: Market | null
  blended: Blend | null
  weight: number
  onWeight: (value: number) => void
  note?: string
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function Bar({ home, away }: { home: number; away: number }) {
  return (
    <div className="bar">
      <div className="bar-home" style={{ width: `${home * 100}%` }}>
        {percent(home)}
      </div>
      <div className="bar-away" style={{ width: `${away * 100}%` }}>
        {percent(away)}
      </div>
    </div>
  )
}

export function PredictionView({
  homeName,
  awayName,
  prediction,
  market,
  blended,
  weight,
  onWeight,
  note,
}: PredictionViewProps) {
  const p = prediction
  return (
    <section className="prediction">
      <h2>
        {homeName} — {awayName}
      </h2>
      {note && <p className="caption warn">{note}</p>}

      <p className="row-label">Основное время — три исхода</p>
      <div className="bar3">
        <div className="bar3-home" style={{ width: `${p.pHome * 100}%` }}>
          {p.pHome > 0.08 && `П1 ${percent(p.pHome)}`}
        </div>
        <div className="bar3-draw" style={{ width: `${p.pDraw * 100}%` }}>
          {p.pDraw > 0.08 && `X ${percent(p.pDraw)}`}
        </div>
        <div className="bar3-away" style={{ width: `${p.pAway * 100}%` }}>
          {p.pAway > 0.08 && `П2 ${percent(p.pAway)}`}
        </div>
      </div>
      <p className="caption">
        П1 / X / П2 в основное время · вероятный счёт {p.score} · ожидаемые голы{' '}
        {p.lambdaHome.toFixed(2)} : {p.lambdaAway.toFixed(2)}
      </p>

      <p className="row-label">Итог с учётом овертайма / буллитов</p>
      <Bar home={p.pHomeFinal} away={p.pAwayFinal} />
      <p className="caption">
        ничья в основное ({percent(p.pDraw)}) разводится в ОТ/буллитах и поровну отнесена к победам
      </p>

      {market && (
        <>
          <p className="row-label">Рынок ({market.source}) — с ОТ/буллитами</p>
          <Bar home={market.pHome} away={market.pAway} />
        </>
      )}

      {blended && market && (
        <>
          <div className="weight">
            <label>
              Вес рынка: {Math.round(weight * 100)}%
              <input
                type="range"
                min={0}
                max={100}
                step={25}
                value={weight * 100}
                onChange={(e) => onWeight(Number(e.target.value) / 100)}
              />
            </label>
          </div>
          <p className="row-label">Итоговый прогноз (модель + рынок)</p>
          <Bar home={blended.pHome} away={blended.pAway} />
        </>
      )}

      <div className="grid">
        <div>
          <span className="label">Вероятный счёт</span>
          <strong>{p.score}</strong>
        </div>
        <div>
          <span className="label">Тотал (ожидаемо)</span>
          <strong>{p.expectedTotal.toFixed(1)}</strong>
        </div>
        <div>
          <span className="label">Больше 5.5</span>
          <strong>{percent(p.pOver)}</strong>
        </div>
        <div>
          <span className="label">Меньше 5.5</span>
          <strong>{percent(1 - p.pOver)}</strong>
        </div>
        <div>
          <span className="label">Победа хозяев (Elo)</span>
          <strong>{percent(p.eloHome)}</strong>
        </div>
        <div>
          <span className="label">Дни отдыха</span>
          <strong>
            {p.restHome} / {p.restAway}
          </strong>
        </div>
      </div>
    </section>
  )
}
