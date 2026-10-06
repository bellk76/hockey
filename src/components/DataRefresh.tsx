import { useCallback, useEffect, useRef, useState } from 'react'
import updated from '../data/updated.json'

type Status = 'idle' | 'running' | 'done' | 'error'

const STALE_MS = 60 * 60 * 1000

interface RefreshEvent {
  type: 'phase' | 'log' | 'done' | 'error' | 'warn'
  phase?: string
  percent?: number
  message?: string
  full?: boolean
  updatedAt?: string
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function DataRefresh() {
  const [status, setStatus] = useState<Status>('idle')
  const [phase, setPhase] = useState('')
  const [percent, setPercent] = useState(0)
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [lastRefresh, setLastRefresh] = useState(() => Date.parse(updated.updatedAt) || 0)
  const sourceRef = useRef<EventSource | null>(null)
  const finishedRef = useRef(false)
  const runningRef = useRef(false)

  const start = useCallback(() => {
    if (runningRef.current) return
    runningRef.current = true
    setStatus('running')
    setError('')
    setWarning('')
    setLines([])
    setPercent(0)
    setPhase('Подключение')
    finishedRef.current = false

    const source = new EventSource('/api/refresh')
    sourceRef.current = source

    source.onmessage = (e) => {
      let ev: RefreshEvent
      try {
        ev = JSON.parse(e.data) as RefreshEvent
      } catch {
        return
      }
      if (ev.type === 'phase') {
        setPhase(ev.phase ?? '')
        setPercent(ev.percent ?? 0)
      } else if (ev.type === 'log') {
        setLines((prev) => [...prev.slice(-40), ev.message ?? ''])
      } else if (ev.type === 'warn') {
        setWarning(ev.message ?? '')
      } else if (ev.type === 'done') {
        finishedRef.current = true
        runningRef.current = false
        setPercent(100)
        setStatus('done')
        if (ev.full) {
          setLastRefresh(ev.updatedAt ? Date.parse(ev.updatedAt) : Date.now())
        }
        source.close()
      } else if (ev.type === 'error') {
        finishedRef.current = true
        runningRef.current = false
        setError(ev.message ?? 'Неизвестная ошибка')
        setStatus('error')
        source.close()
      }
    }
    source.onerror = () => {
      runningRef.current = false
      if (!finishedRef.current) {
        setError('Соединение с сервером прервано. Запущено ли `npm run dev`?')
        setStatus('error')
      }
      source.close()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/refresh/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { available?: boolean } | null) => {
        if (cancelled || !info?.available) return
        const last = Date.parse(updated.updatedAt) || 0
        if (Date.now() - last > STALE_MS) start()
      })
      .catch(() => {
        /* не dev — автообновление недоступно */
      })
    return () => {
      cancelled = true
    }
  }, [start])

  const cancel = async () => {
    try {
      await fetch('/api/refresh/cancel')
    } catch {
      /* ignore */
    }
    sourceRef.current?.close()
    finishedRef.current = true
    runningRef.current = false
    setStatus('idle')
    setPhase('')
  }

  return (
    <section className="matches">
      <h2>Обновление данных</h2>
      <div className="presets">
        <button type="button" className="chip" onClick={start} disabled={status === 'running'}>
          Обновить данные
        </button>
        {status === 'running' && (
          <button type="button" className="chip" onClick={cancel}>
            Отмена
          </button>
        )}
        {status === 'done' && (
          <button type="button" className="chip active" onClick={() => window.location.reload()}>
            Применить (перезагрузить)
          </button>
        )}
      </div>

      <p className="caption">
        Последнее полное обновление: {lastRefresh ? formatTime(lastRefresh) : '—'} (матчи + кэфы). Отметка
        ставится только при полном успехе; авто-обновление срабатывает в dev, если прошло больше часа.
      </p>

      {status === 'running' && (
        <>
          <div className="progress">
            <div style={{ width: `${percent}%` }} />
          </div>
          <p className="caption">
            {phase}
            {percent ? ` · ${percent}%` : ''}
          </p>
        </>
      )}

      {lines.length > 0 && <pre className="log">{lines.join('\n')}</pre>}

      {warning && <div className="warn-box">{warning}</div>}

      {status === 'error' && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      {status === 'done' && !warning && <p className="caption ok">Готово: данные обновлены.</p>}
    </section>
  )
}
