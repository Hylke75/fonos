// Lokale server: de app plus geüploade bestanden en de gebouwde frontend.
process.env.TZ ??= 'Europe/Amsterdam'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { app } from './app.ts'
import { db, ROOT } from './db.ts'
import { OPSLAG_DIR } from './opslag.ts'
import { tik } from './planner.ts'

await db()

app.use('/uploads/*', serveStatic({ root: relative(process.cwd(), OPSLAG_DIR) || '.', rewriteRequestPath: (p) => p.replace(/^\/uploads/, '') }))

const dist = join(ROOT, 'dist')
if (existsSync(dist)) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  app.use('/*', serveStatic({ root: relative(process.cwd(), dist) }))
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.json({ fout: 'Niet gevonden' }, 404) : c.html(html)))
}

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => console.log(`Fonotheek draait op http://localhost:${port}`))
// Lokaal draait de planner elke minuut (op Vercel via Cron en via verzoeken).
setInterval(() => { tik({ backup: true }).catch((e) => console.error('[planner]', e)) }, 60_000)
