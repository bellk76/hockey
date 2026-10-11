import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Prediction } from '../types'
import type { StreakInfo } from '../utils/streaks'
import { PredictionView } from './PredictionView'

afterEach(cleanup)

const prediction: Prediction = {
  lambdaHome: 3.1,
  lambdaAway: 2.4,
  pHome: 0.52,
  pAway: 0.31,
  pDraw: 0.17,
  pHomeFinal: 0.6,
  pAwayFinal: 0.4,
  eloHome: 0.55,
  score: '3:2',
  expectedTotal: 5.5,
  pOver: 0.55,
  restHome: 2,
  restAway: 1,
  travel: 0,
}

const streak = (over: Partial<StreakInfo>): StreakInfo => ({
  type: 'win',
  length: 4,
  maxWin: 9,
  maxLoss: 6,
  isExtremeWin: false,
  isExtremeLoss: false,
  ...over,
})

function renderView(homeStreak?: StreakInfo | null, awayStreak?: StreakInfo | null) {
  return render(
    <PredictionView
      homeName="Carolina"
      awayName="Vancouver"
      prediction={prediction}
      market={null}
      blended={null}
      weight={0}
      onWeight={() => {}}
      homeStreak={homeStreak}
      awayStreak={awayStreak}
    />,
  )
}

describe('PredictionView · предупреждения о сериях', () => {
  it('предупреждает о победной серии честно: влияет только на выбор суперматча (★)', () => {
    const { container } = renderView(streak({ isExtremeWin: true }), null)
    const warns = container.querySelectorAll('.streak-warn')
    expect(warns).toHaveLength(1)
    const text = warns[0].textContent ?? ''
    expect(text).toContain('Победная серия Carolina (4)')
    expect(text).toContain('близка к рекорду (9)')
    expect(text).toContain('выборе суперматча (★)')
    expect(text).toContain('на вероятности ниже не влияет')
    // Старая (ложная) формулировка не должна вернуться.
    expect(text).not.toContain('вероятность завершения повышена')
  })

  it('предупреждает о проигрышной серии честно: отскок и только ★', () => {
    const { container } = renderView(null, streak({ type: 'loss', length: 6, maxLoss: 6, isExtremeLoss: true }))
    const warns = container.querySelectorAll('.streak-warn')
    expect(warns).toHaveLength(1)
    const text = warns[0].textContent ?? ''
    expect(text).toContain('Проигрышная серия Vancouver (6)')
    expect(text).toContain('рекорду (6)')
    expect(text).toContain('возможен отскок')
    expect(text).toContain('только на выбор суперматча (★)')
  })

  it('обе серии — два предупреждения', () => {
    const { container } = renderView(streak({ isExtremeWin: true }), streak({ type: 'loss', isExtremeLoss: true }))
    expect(container.querySelectorAll('.streak-warn')).toHaveLength(2)
  })

  it('не показывает серии, которые штраф для ★ не использует', () => {
    // Фаворит — Carolina (pHomeFinal 0.6): его проигрышная серия и
    // победная серия аутсайдера в штраф не входят — предупреждений нет.
    const { container } = renderView(
      streak({ type: 'loss', isExtremeLoss: true }),
      streak({ length: 7, isExtremeWin: true }),
    )
    expect(container.querySelectorAll('.streak-warn')).toHaveLength(0)
  })

  it('при длине >= рекорда пишет «уже превысила рекорд»', () => {
    const { container } = renderView(streak({ length: 10, maxWin: 9, isExtremeWin: true }), null)
    const text = container.querySelector('.streak-warn')?.textContent ?? ''
    expect(text).toContain('уже превысила рекорд (9)')
    expect(text).not.toContain('близка к рекорду')
  })

  it('без экстремальных серий и без данных — предупреждений нет', () => {
    const plain = renderView(streak({ length: 2 }), null)
    expect(plain.container.querySelectorAll('.streak-warn')).toHaveLength(0)
    cleanup()
    const empty = renderView(null, null)
    expect(empty.container.querySelectorAll('.streak-warn')).toHaveLength(0)
  })
})
