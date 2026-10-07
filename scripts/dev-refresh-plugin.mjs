import { spawn } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TMP = '.tmp-odds.json'
const PYTHON = process.env.HOCKEY_PYTHON || 'python'
const ODDSHARVESTER = process.env.HOCKEY_ODDSHARVESTER || 'oddsharvester'
// Основной www.oddsportal.com часто недоступен; зеркало (региональный домен) работает.
// Переопределяется через HOCKEY_ODDS_BASE_URL (принимается только https).
const DEFAULT_BASE_URL = 'https://www.centroquote.it'
const ODDS_LOCALE = process.env.HOCKEY_ODDS_LOCALE || 'it-IT'
const ODDS_TIMEZONE = process.env.HOCKEY_ODDS_TIMEZONE || 'Europe/Rome'
const TIMEOUT_MS = 15 * 60 * 1000

function resolveBaseUrl(raw) {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return DEFAULT_BASE_URL
    return url.origin
  } catch {
    return DEFAULT_BASE_URL
  }
}

const ODDS_BASE_URL = resolveBaseUrl(process.env.HOCKEY_ODDS_BASE_URL || DEFAULT_BASE_URL)

let running = false
let currentChild = null

function killChild(child) {
  if (!child || child.killed) return
  if (process.platform === 'win32' && child.pid) {
    // /T — снять всё дерево процессов (oddsharvester -> Playwright/Chromium)
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      /* ignore */
    }
    return
  }
  try {
    child.kill('SIGKILL')
  } catch {
    /* ignore */
  }
}

function run(cmd, args, cwd, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: false })
    currentChild = child
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killChild(child)
      reject(new Error('Превышено время выполнения (15 минут)'))
    }, TIMEOUT_MS)

    const pipe = (buf) => {
      for (const line of buf.toString().split(/\r?\n/)) {
        if (line.trim()) onLine(line.trim())
      }
    }
    child.stdout.on('data', pipe)
    child.stderr.on('data', pipe)
    child.on('error', (e) => {
      clearTimeout(timer)
      currentChild = null
      reject(new Error(`Не удалось запустить «${cmd}»: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      currentChild = null
      if (timedOut) return
      if (code === 0) resolve()
      else reject(new Error(`Команда «${cmd}» завершилась с кодом ${code}`))
    })
  })
}

export function dataRefresh() {
  return {
    name: 'hockey-data-refresh',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root

      server.middlewares.use('/api/refresh/status', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ available: true, running }))
      })

      server.middlewares.use('/api/refresh/cancel', (_req, res) => {
        killChild(currentChild)
        running = false
        res.statusCode = 200
        res.end('cancelled')
      })

      server.middlewares.use('/api/refresh', async (req, res) => {
        if (req.url.startsWith('/status') || req.url.startsWith('/cancel')) return
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
        res.flushHeaders?.()

        let closed = false
        res.on('close', () => {
          closed = true
          killChild(currentChild)
        })

        const send = (event) => {
          if (closed || res.writableEnded) return
          try {
            res.write(`data: ${JSON.stringify(event)}\n\n`)
          } catch {
            closed = true
          }
        }
        const log = (message) => send({ type: 'log', message })

        if (running) {
          send({ type: 'error', message: 'Обновление уже выполняется' })
          res.end()
          return
        }
        running = true

        try {
          // 1. Матчи — обязательная фаза
          try {
            send({ type: 'phase', phase: 'Матчи', percent: 5 })
            await run('node', ['scripts/fetch-nhl.mjs', '--current'], root, log)
          } catch (e) {
            const message = String(e?.message || e)
            const hint = /ENOENT|not recognized|не найден/i.test(message)
              ? ' Проверьте, что установлен Node.js.'
              : ''
            send({ type: 'error', message: message + hint })
            return
          }

          // 1b. Продвинутая статистика 5v5 — необязательная фаза
          try {
            send({ type: 'phase', phase: 'Статистика 5v5', percent: 25 })
            await run('node', ['scripts/fetch-advanced.mjs', '--current'], root, log)
          } catch (e) {
            send({ type: 'warn', message: `Матчи обновлены. 5v5-статистику собрать не удалось: ${String(e?.message || e)}` })
          }

          // 2. Коэффициенты — необязательная фаза (Oddsportal часто блокирует сбор)
          try {
            send({ type: 'phase', phase: 'Коэффициенты', percent: 45 })
            log(`Запускаю OddsHarvester (${ODDSHARVESTER}) через ${ODDS_BASE_URL}… это может занять несколько минут`)
            await run(
              ODDSHARVESTER,
              [
                'upcoming', '-s', 'ice-hockey', '-l', 'nhl', '-m', 'home_away,over_under_5_5',
                '--headless', '-f', 'json', '-o', TMP,
                '--base-url', ODDS_BASE_URL, '--locale', ODDS_LOCALE, '--timezone', ODDS_TIMEZONE,
              ],
              root,
              log,
            )
            send({ type: 'phase', phase: 'Конвертация', percent: 90 })
            await run(PYTHON, ['scripts/convert_odds.py', TMP], root, log)
            const updatedAt = new Date().toISOString()
            writeFileSync(join(root, 'src', 'data', 'updated.json'), JSON.stringify({ updatedAt }))
            send({ type: 'done', percent: 100, full: true, updatedAt })
          } catch (e) {
            const message = String(e?.message || e)
            const hint = /ENOENT|not recognized|не найден/i.test(message)
              ? ' Похоже, не установлен OddsHarvester/Python: pip install oddsharvester.'
              : ' Oddsportal часто блокирует автоматический сбор — попробуйте позже или через прокси.'
            send({ type: 'warn', message: `Матчи обновлены. Кэфы собрать не удалось: ${message}.${hint}` })
            send({ type: 'done', percent: 100, full: false })
          }
        } finally {
          try {
            rmSync(join(root, TMP), { force: true })
          } catch {
            /* ignore */
          }
          running = false
          if (!closed && !res.writableEnded) res.end()
        }
      })
    },
  }
}
