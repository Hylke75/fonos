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
import { openBlob } from './opslag.ts'
import { run } from './db.ts'

export const app = new Hono()

/** Kiosktablets met een naam (header X-Fonos-Tablet): hooguit eens per 30 s "laatst gezien" bijwerken. */
const gezien = new Map<string, number>()
function kioskGezien(naam: string | undefined, pagina: string | undefined) {
  if (!naam) return
  const n = naam.trim().slice(0, 60)
  if (!n || Date.now() - (gezien.get(n) ?? 0) < 30_000) return
  gezien.set(n, Date.now())
  run('INSERT INTO kiosks (naam, laatst_gezien, pagina) VALUES (?, nu(), ?) ON CONFLICT (naam) DO UPDATE SET laatst_gezien = nu(), pagina = excluded.pagina',
    n, pagina?.slice(0, 120) ?? null).catch(() => {})
}

app.use('*', async (c, next) => {
  tikTerloops()
  const dec = (v?: string) => { try { return v ? decodeURIComponent(v) : undefined } catch { return undefined } }
  kioskGezien(dec(c.req.header('x-fonos-tablet')), dec(c.req.header('x-fonos-pagina')))
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
  await run("INSERT INTO planner (taak, datum) VALUES ('cron:laatst', nu()) ON CONFLICT (taak) DO UPDATE SET datum = excluded.datum")
  await tik({ backup: true, cron: true })
  return c.json({ ok: true })
})

/** Bestanden uit de privé Blob-store. Hoezen zijn voor iedereen; back-ups en uploads alleen voor beheerders. */
app.get('/api/bestand/*', async (c) => {
  const pad = decodeURIComponent(c.req.path.slice('/api/bestand/'.length))
  if (pad.includes('..') || !/^(hoezen|backups|uploads)\//.test(pad)) return c.json({ fout: 'Niet gevonden' }, 404)
  if (!pad.startsWith('hoezen/')) {
    const g = await gebruikerBijToken(getCookie(c, COOKIE))
    if (!g?.rollen.includes('beheerder')) return c.json({ fout: 'Geen rechten' }, 403)
  }
  const r = await openBlob(pad)
  if (!r || r.statusCode !== 200) return c.json({ fout: 'Niet gevonden' }, 404)
  return new Response(r.stream as any, { headers: {
    'Content-Type': r.blob.contentType ?? 'application/octet-stream',
    'Cache-Control': pad.startsWith('hoezen/') ? 'public, max-age=86400' : 'private, no-store',
    ...(pad.startsWith('hoezen/') ? {} : { 'Content-Disposition': `attachment; filename="${pad.split('/').pop()}"` }),
  } })
})

app.get('/api/gezond', (c) => c.json({ ok: true }))
