// De Hono-app: API's voor kiosk, medewerker en beheer. Draait lokaal (server/index.ts) en op Vercel (api/index.ts).
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { kiosk } from './routes/kiosk.ts'
import { medewerker } from './routes/medewerker.ts'
import { beheer } from './routes/beheer.ts'
import { auth } from './routes/auth.ts'
import { versies } from './events.ts'
import { COOKIE, gebruikerBijToken } from './auth.ts'
import { tik, tikTerloops } from './planner.ts'

export const app = new Hono()

app.use('*', async (c, next) => {
  tikTerloops()
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'same-origin')
  if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store')
})

app.onError((e, c) => {
  console.error(e)
  return c.json({ fout: e.message || 'Er ging iets mis' }, 500)
})

app.route('/api/kiosk', kiosk)
app.route('/api/medewerker', medewerker)
app.route('/api/beheer', beheer)
app.route('/api/auth', auth)

/** Tellers voor realtime verversen; de schermen vragen dit elke paar seconden op. */
app.get('/api/versies', async (c) => {
  const v = await versies()
  // Het bestelnummer van de laatste nieuwe aanvraag alleen voor ingelogde medewerkers.
  if (!(await gebruikerBijToken(getCookie(c, COOKIE)))) delete v.laatste_nieuw
  return c.json(v)
})

/** Vercel Cron: sluitingstijd en nachtelijke back-up. */
app.get('/api/cron', async (c) => {
  const geheim = process.env.CRON_SECRET
  if (geheim && c.req.header('authorization') !== `Bearer ${geheim}`) return c.json({ fout: 'Niet toegestaan' }, 401)
  await tik({ backup: true })
  return c.json({ ok: true })
})

app.get('/api/gezond', (c) => c.json({ ok: true }))
