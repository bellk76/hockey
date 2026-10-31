// Фолбэк на системный curl для JSON-запросов. Нужен, когда встроенный Node-fetch
// не может установить соединение (например, блокировка по TLS-отпечатку или
// промежуточный фильтр), тогда как curl к тому же хосту достукивается.
import { execFile } from 'node:child_process'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export function curlJson(url) {
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      [
        '-sL',
        '--max-time', '30',
        '-H', `User-Agent: ${UA}`,
        '-H', 'Accept: application/json',
        '-w', '\n__HTTP__%{http_code}',
        url,
      ],
      { maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(new Error(`curl: ${err.message}`))
        const [body, codeRaw] = stdout.split('\n__HTTP__')
        const code = Number(codeRaw) || 0
        if (code === 404) return resolve(null)
        if (code >= 400) return reject(new Error(`curl вернул HTTP ${code}`))
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          reject(new Error(`curl вернул не-JSON (HTTP ${code}): ${e.message}`))
        }
      },
    )
  })
}
