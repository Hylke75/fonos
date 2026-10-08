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
import { get, run } from './db.ts'
import { meld } from './meldingen.ts'
import BEVEILIGING from '../shared/beveiligingsheaders.json' with { type: 'json' }

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
  // Beveiligingsheaders (IT-beleid 5.6); op Vercel zet scripts/bouw-vercel.mjs dezelfde voor de statische bestanden.
  // Lokaal (http) geen HSTS en geen upgrade-insecure-requests.
  const https = new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https'
  for (const [k, v] of Object.entries(BEVEILIGING)) {
    if (k === 'Strict-Transport-Security' && !https) continue
    c.header(k, k === 'Content-Security-Policy' && !https ? v.replace(/;\s*upgrade-insecure-requests/, '') : v)
  }
  if (c.req.path.startsWith('/api/') && !c.res.headers.get('Cache-Control')) c.header('Cache-Control', 'no-store')
})

app.onError((e, c) => {
  console.error(e)
  // IT-beleid 6.2: beheerders krijgen hooguit één melding per dag over serverfouten.
  meld('serverfout', 'Fout in de Fonotheek-server', `${c.req.method} ${c.req.path}\n\n${e?.stack ?? e?.message ?? e}`).catch(() => {})
  return c.json({ fout: e.message || 'Er ging iets mis' }, 500)
})

/** Fouten uit de browser (verbetering 20). Geen login nodig (kiosk); begrensd en zonder persoonsgegevens. */
let foutenDitUur = { uur: '', n: 0 }
app.post('/api/fout', async (c) => {
  const uur = new Date().toISOString().slice(0, 13)
  if (foutenDitUur.uur !== uur) foutenDitUur = { uur, n: 0 }
  if (++foutenDitUur.n > 200) return c.json({ ok: false }, 429)
  const b = await c.req.json<{ bericht?: string; bron?: string; stack?: string; pagina?: string }>().catch(() => ({} as any))
  const bericht = String(b.bericht ?? '').slice(0, 500)
  if (!bericht) return c.json({ ok: false }, 400)
  const dec = (v?: string) => { try { return v ? decodeURIComponent(v) : null } catch { return null } }
  const tablet = dec(c.req.header('x-fonos-tablet'))?.slice(0, 60) ?? null
  console.error(`[browser] ${tablet ?? 'onbekend apparaat'} ${b.pagina ?? ''}: ${bericht}`)
  await run('INSERT INTO browserfouten (tablet, pagina, bericht, bron, stack, apparaat) VALUES (?, ?, ?, ?, ?, ?)',
    tablet, String(b.pagina ?? '').slice(0, 200), bericht, String(b.bron ?? '').slice(0, 300), String(b.stack ?? '').slice(0, 3000), (c.req.header('user-agent') ?? '').slice(0, 200))
  await run("DELETE FROM browserfouten WHERE tijd < nu('-30 days')")
  // Komt dezelfde fout vaak voor (5× in een uur), dan een storingsmelding (hooguit één per dag per fout).
  const n = (await get<{ n: number }>("SELECT COUNT(*)::int AS n FROM browserfouten WHERE bericht = ? AND tijd > nu('-1 hour')", bericht))!.n
  if (n >= 5) await meld(`browserfout:${bericht.slice(0, 80)}`, 'Herhaalde fout in de browser', `Deze fout trad het afgelopen uur ${n} keer op${tablet ? ` (laatst op ${tablet})` : ''}:\n\n${bericht}\n${b.bron ?? ''}\n\n${String(b.stack ?? '').slice(0, 1500)}`)
  return c.json({ ok: true })
})

/** Voor de monitoring van B&G (IT-beleid 6.2): 200 als alles goed is, 503 bij een probleem. Geen gevoelige gegevens. */
app.get('/api/gezond', async (c) => {
  const controles: Record<string, boolean> = {}
  try { await get('SELECT 1'); controles.database = true } catch { controles.database = false }
  if (controles.database) {
    const cron = await get<{ datum: string }>("SELECT datum FROM planner WHERE taak = 'cron:laatst'").catch(() => null)
    if (cron) {
      controles.nachtelijke_taak = !!(await get("SELECT 1 FROM planner WHERE taak = 'cron:laatst' AND datum > nu('-26 hours')").catch(() => null))
      controles.backup = !!(await get("SELECT 1 FROM backups WHERE status = 'gelukt' AND tijd > nu('-26 hours')").catch(() => null))
    }
  }
  const ok = Object.values(controles).every(Boolean)
  return c.json({ ok, controles, tijd: new Date().toISOString() }, ok ? 200 : 503)
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
