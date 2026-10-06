// Server van de Fonotheek-app: API, realtime (SSE), geüploade hoezen en de gebouwde frontend.
process.env.TZ ??= 'Europe/Amsterdam'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { getCookie } from 'hono/cookie'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { db, ROOT, UPLOAD_DIR } from './db.ts'
import { kiosk } from './routes/kiosk.ts'
import { medewerker } from './routes/medewerker.ts'
import { beheer } from './routes/beheer.ts'
import { auth } from './routes/auth.ts'
import { abonneer } from './events.ts'
import { COOKIE, gebruikerBijToken } from './auth.ts'
import { bouwIndex } from './zoeken.ts'
import { startPlanner } from './planner.ts'

db()
const index = bouwIndex()
console.log(`Zoekindex: ${index.titels} titels, ${index.woorden} woorden (${index.ms} ms)`)

const app = new Hono()

app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'same-origin')
})

app.onError((e, c) => {
  console.error(e)
  return c.json({ fout: e.message || 'Er ging iets mis' }, 500)
})

app.route('/api/kiosk', kiosk)
app.route('/api/medewerker', medewerker)
app.route('/api/beheer', beheer)
app.route('/api/auth', auth)

app.get('/api/events', (c) => {
  const kanaal = c.req.query('kanaal') === 'medewerker' ? 'medewerker' : 'kiosk'
  if (kanaal === 'medewerker' && !gebruikerBijToken(getCookie(c, COOKIE))) return c.json({ fout: 'Niet ingelogd' }, 401)
  return streamSSE(c, async (stream) => {
    let open = true
    const stop = abonneer({ kanaal, send: (event, data) => { stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => { open = false }) } })
    stream.onAbort(() => { open = false })
    while (open) {
      await stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => { open = false })
      await stream.sleep(20_000)
    }
    stop()
  })
})

app.get('/api/gezond', (c) => c.json({ ok: true }))

app.use('/uploads/*', serveStatic({ root: relative(process.cwd(), UPLOAD_DIR) || '.', rewriteRequestPath: (p) => p.replace(/^\/uploads/, '') }))

const dist = join(ROOT, 'dist')
if (existsSync(dist)) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  app.use('/assets/*', serveStatic({ root: relative(process.cwd(), dist) }))
  app.use('/*', serveStatic({ root: relative(process.cwd(), dist) }))
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.json({ fout: 'Niet gevonden' }, 404) : c.html(html)))
}

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => console.log(`Fonotheek draait op http://localhost:${port}`))
startPlanner()
