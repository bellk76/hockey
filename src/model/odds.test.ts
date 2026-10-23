import { describe, expect, it } from 'vitest'
import { findMarket, oddsData } from './odds'

const sample = oddsData[0]

describe('findMarket · поиск кэфа по паре команд', () => {
  it('находит запись на точную дату', () => {
    expect(findMarket(sample.home, sample.away, sample.date)).toBe(sample)
  })

  it('допускает сдвиг даты на сутки (часовой пояс Oddsportal)', () => {
    const nextDay = new Date(Date.parse(sample.date) + 86_400_000).toISOString().slice(0, 10)
    expect(findMarket(sample.home, sample.away, nextDay)).not.toBeNull()
  })

  it('возвращает null для неизвестной пары и далёкой даты', () => {
    expect(findMarket('XXX', 'YYY', sample.date)).toBeNull()
    expect(findMarket(sample.home, sample.away, '2000-01-01')).toBeNull()
  })
})
