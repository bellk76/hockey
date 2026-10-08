import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Game } from '../types'
import { MatchList, type ListRow } from './MatchList'

afterEach(cleanup)

const NAME: Record<string, string> = {
  CAR: 'Carolina',
  VAN: 'Vancouver',
  BOS: 'Boston',
  NJD: 'New Jersey',
}

const nameOf = (abbrev: string) => NAME[abbrev] ?? abbrev
const marketOf = () => null
const onSelect = () => {}

const rows: ListRow[] = [{ date: '2026-10-08', home: 'CAR', away: 'VAN', pHome: 0.62, pAway: 0.38 }]

function game(id: string, date: string, home: string, away: string, hs: number, as: number): Game {
  return { id, date, home, away, hs, as, outcome: 'REG' }
}

function renderUpcoming(recentOf?: (team: string, date: string, n?: number) => Game[]) {
  return render(
    <MatchList
      title="Ближайшие матчи"
      rows={rows}
      nameOf={nameOf}
      marketOf={marketOf}
      onSelect={onSelect}
      emptyText="Нет предстоящих матчей."
      recentOf={recentOf}
    />,
  )
}

describe('MatchList · форма команд', () => {
  it('показывает последние матчи хозяев и гостей: дата, команды и счёт', () => {
    const recent: Record<string, Game[]> = {
      CAR: [
        game('1', '2026-10-06', 'CAR', 'BOS', 4, 2),
        game('2', '2026-10-04', 'BOS', 'CAR', 3, 1),
        game('3', '2026-10-02', 'CAR', 'NJD', 5, 3),
      ],
      VAN: [
        game('4', '2026-10-05', 'VAN', 'BOS', 2, 3),
        game('5', '2026-10-01', 'BOS', 'VAN', 1, 4),
      ],
    }
    const { container } = renderUpcoming((team) => recent[team] ?? [])

    const form = container.querySelector('.match-form')
    expect(form).not.toBeNull()
    const text = form?.textContent ?? ''
    expect(text).toContain('Форма команд · последние 3 матча')
    expect(text).toContain('Carolina')
    expect(text).toContain('Vancouver')
    // Дата, хозяева — гости, счёт в порядке хозяева:гости.
    expect(text).toContain('10-06 Carolina — Boston 4:2')
    expect(text).toContain('10-04 Boston — Carolina 3:1')
    expect(text).toContain('10-02 Carolina — New Jersey 5:3')
    expect(text).toContain('10-05 Vancouver — Boston 2:3')
    expect(text).toContain('10-01 Boston — Vancouver 1:4')

    const lines = container.querySelectorAll('.match-form-game')
    expect(lines).toHaveLength(5)
    // Подсветка относительно команды-заголовка: Carolina победила (10-06) — зелёная точка и счёт.
    expect(lines[0].querySelector('.match-form-dot.ok')).not.toBeNull()
    expect(lines[0].querySelector('b')?.className).toContain('ok')
    // Carolina проиграла (10-04) — красная точка и счёт.
    expect(lines[1].querySelector('.match-form-dot.bad')).not.toBeNull()
    expect(lines[1].querySelector('b')?.className).toContain('bad')
    // Цветом и жирным выделяется только ключевая команда (чья форма) — по её результату.
    expect(lines[0].querySelector('.match-form-key.ok')?.textContent).toBe('Carolina')
    expect(lines[1].querySelector('.match-form-key.bad')?.textContent).toBe('Carolina')
    expect(lines[3].querySelector('.match-form-key.bad')?.textContent).toBe('Vancouver')
    // Победа гостевой ключевой команды (Vancouver 10-01, isHome=false) — тоже зелёная.
    expect(lines[4].querySelector('.match-form-key.ok')?.textContent).toBe('Vancouver')
    expect(lines[4].querySelector('.match-form-dot.ok')).not.toBeNull()
    expect(lines[4].querySelector('b')?.className).toContain('ok')
    // Соперник не выделяется — ключевая команда в строке ровно одна.
    expect(lines[1].querySelectorAll('.match-form-key')).toHaveLength(1)
    // Результат доступен и текстом (не только цветом).
    expect(lines[0].querySelector('.sr-only')?.textContent?.trim()).toBe('победа')
    expect(lines[1].querySelector('.sr-only')?.textContent?.trim()).toBe('поражение')
  })

  it('без сыгранных матчей показывает заглушку для каждой команды', () => {
    const { container } = renderUpcoming(() => [])
    const form = container.querySelector('.match-form')
    expect(form).not.toBeNull()
    expect(container.querySelectorAll('.match-form-game')).toHaveLength(0)
    const empty = container.querySelectorAll('.match-form-empty')
    expect(empty).toHaveLength(2)
    expect(empty[0].textContent).toBe('нет сыгранных матчей')
  })

  it('без пропа recentOf блок формы не рендерится', () => {
    const { container } = renderUpcoming()
    expect(container.querySelector('.match-form')).toBeNull()
  })
})
