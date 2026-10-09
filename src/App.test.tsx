import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'

afterEach(cleanup)

// Нативные <select> тоже имеют роли combobox/option, поэтому все запросы ограничиваем
// контейнером селектора «Матч».
function picker() {
  const combo = screen.getByRole('combobox', { name: /Матч/ })
  const root = combo.closest('.match-picker') as HTMLElement
  return { combo, root }
}

describe('App · селектор «Матч» (кастомный список)', () => {
  it('раскрывается сверху: первый пункт = текущий матч, даты по убыванию', () => {
    render(<App />)
    const { combo, root } = picker()
    const closed = combo.querySelector('.picker-value')?.textContent ?? ''

    fireEvent.click(combo)
    const options = within(root).getAllByRole('option')

    expect(options.length).toBeGreaterThan(0)
    expect(options[0].textContent).toBe(closed)
    // Подсвечен именно верхний пункт — список открылся с начала.
    expect(options[0].classList.contains('active')).toBe(true)

    const dates = options.map((o) => o.textContent!.split(' · ')[0])
    const descending = dates.every((d, i) => i === 0 || dates[i - 1] >= d)
    expect(descending).toBe(true)
    expect(combo.getAttribute('aria-expanded')).toBe('true')
  })

  it('после выбора не-верхнего матча повторное открытие снова начинается сверху', () => {
    render(<App />)
    const { combo, root } = picker()

    fireEvent.click(combo)
    fireEvent.click(within(root).getAllByRole('option')[3])

    fireEvent.click(combo)
    const options = within(root).getAllByRole('option')
    expect(options[0].classList.contains('active')).toBe(true)
  })

  it('с клавиатуры: ArrowDown открывает, ArrowDown+Enter выбирает следующий матч', () => {
    render(<App />)
    const { combo, root } = picker()

    fireEvent.keyDown(combo, { key: 'ArrowDown' }) // открыть
    const options = within(root).getAllByRole('option')
    expect(options[0].classList.contains('active')).toBe(true)

    fireEvent.keyDown(combo, { key: 'ArrowDown' }) // вниз
    expect(options[1].classList.contains('active')).toBe(true)

    fireEvent.keyDown(combo, { key: 'Enter' }) // выбрать
    expect(within(root).queryAllByRole('option')).toHaveLength(0)
    expect(combo.querySelector('.picker-value')?.textContent).toBe(options[1].textContent)
    expect(document.activeElement).toBe(combo)
  })

  it('закрывается по Escape и возвращает фокус на контрол', () => {
    render(<App />)
    const { combo, root } = picker()

    fireEvent.click(combo)
    expect(within(root).queryAllByRole('option').length).toBeGreaterThan(0)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(within(root).queryAllByRole('option')).toHaveLength(0)
    expect(document.activeElement).toBe(combo)
  })
})
