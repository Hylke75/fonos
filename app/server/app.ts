// De Hono-app: API's voor kiosk, medewerker en beheer. Draait lokaal (server/index.ts) en op Vercel (api/index.ts).
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { kiosk } from './routes/kiosk.ts'
import { medewerker } from './routes/medewerker.ts'
import { beheer } from './routes/beheer.ts'
import { auth } from './routes/auth.ts'
import { versies } from './events.ts'
import { COOKIE, gebruikerBijToken } from './auth.ts'
import { gebruiker, kiosk as kioskVan, toegang } from './toegang.ts'
import { GebruikersFout, referentie } from './fouten.ts'
import { rem } from './rem.ts'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { tik, tikTerloops } from './planner.ts'
import { openBlob } from './opslag.ts'
import { get, run } from './db.ts'
import { haal } from './naarbuiten.ts'
import { meld } from './meldingen.ts'
import BEVEILIGING from '../shared/beveiligingsheaders.json' with { type: 'json' }

export const app = new Hono()

app.use('*', async (c, next) => {
  await tikTerloops()
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

// CSRF (securityreview R10): formulieren en tekstverzoeken alleen van ons eigen adres. JSON-verzoeken van een ander
// adres kunnen niet zonder CORS, dat we niet toestaan. Daarna de toegangsmodule: elke route heeft een regel, anders dicht.
app.use('/api/*', csrf())
app.use('*', toegang)

app.onError(async (e, c) => {
  if (e instanceof HTTPException) return e.getResponse()
  if (e instanceof GebruikersFout) return c.json({ fout: e.message, ...(e.code ? { code: e.code } : {}) }, e.status)
  // Kapotte JSON van buiten is geen serverfout: geen storingsmelding (securityreview R16).
  if (e instanceof SyntaxError) return c.json({ fout: 'Ongeldig verzoek' }, 400)
  // Wachten op het platenspeler-slot duurde te lang (lock_timeout): een begrijpelijke melding in plaats van de databasefout.
  if ((e as any)?.code === '55P03') return c.json({ fout: 'Het lukt even niet. Probeer het zo nog eens.', code: 'druk' }, 503)
  const ref = referentie()
  console.error(`[fout ${ref}]`, e)
  // IT-beleid 6.2: beheerders krijgen hooguit één melding per dag over serverfouten. Afwachten: op Vercel stopt de functie na het antwoord.
  await meld('serverfout', 'Fout in de Luisterbar-server', `${c.req.method} ${c.req.path} (referentie ${ref})\n\n${e?.stack ?? e?.message ?? e}`).catch(() => {})
  // Nooit de interne fouttekst naar buiten (securityreview R8): de referentie verwijst naar het serverlog.
  return c.json({ fout: `Er ging iets mis (referentie ${ref}).` }, 500)
})

/** Fouten uit de browser (verbetering 20). Alleen van gekoppelde kiosks en ingelogde gebruikers (toegang.ts), begrensd.
 *  De tekst komt uit de browser en is dus niet te vertrouwen: hij gaat naar Beheer → Status, nooit in een e-mail. */
app.post('/api/fout', async (c) => {
  const k = kioskVan(c), g = gebruiker(c)
  const bron = k ? `kiosk:${k.naam}` : `gebruiker:${g?.id}`
  if (!(await rem(`fout:${bron}`, 60, 60))) return c.json({ ok: false }, 429)
  const b = await c.req.json<{ bericht?: string; bron?: string; stack?: string; pagina?: string }>().catch(() => ({} as any))
  const bericht = String(b.bericht ?? '').slice(0, 500)
  if (!bericht) return c.json({ ok: false }, 400)
  const tablet = k?.naam ?? g?.naam ?? null
  console.error(`[browser] ${tablet ?? 'onbekend apparaat'} ${String(b.pagina ?? '').slice(0, 200)}: ${bericht}`)
  await run('INSERT INTO browserfouten (tablet, pagina, bericht, bron, stack, apparaat) VALUES (?, ?, ?, ?, ?, ?)',
    tablet, String(b.pagina ?? '').slice(0, 200), bericht, String(b.bron ?? '').slice(0, 300), String(b.stack ?? '').slice(0, 3000), (c.req.header('user-agent') ?? '').slice(0, 200))
  await run("DELETE FROM browserfouten WHERE tijd < nu('-30 days')")
  // Komt dezelfde fout vaak voor (5× in een uur), dan een storingsmelding met een vaste tekst (hooguit één per dag).
  const n = (await get<{ n: number }>("SELECT COUNT(*)::int AS n FROM browserfouten WHERE bericht = ? AND tijd > nu('-1 hour')", bericht))!.n
  if (n >= 5) await meld('browserfouten', 'Herhaalde fouten in de browser',
    'Er treden herhaaldelijk fouten op in de browser van een kiosk of de beheeromgeving. Bekijk de details in Beheer → Status.')
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

/** Vercel Cron (alleen met CRON_SECRET): sluitingstijd en nachtelijke back-up. */
app.get('/api/cron', async (c) => {
  // CRON_SECRET wordt gecontroleerd in toegang.ts (fail-closed: zonder geheim mag niemand).
  await run("INSERT INTO planner (taak, datum) VALUES ('cron:laatst', nu()) ON CONFLICT (taak) DO UPDATE SET datum = excluded.datum")
  await tik({ backup: true, cron: true })
  return c.json({ ok: true })
})

/** Muziekweb-hoezen via ons eigen domein. Sommige netwerken (bv. met een bedrijfsfilter) laden media.cdr.nl niet,
 *  waardoor de kiosk alleen placeholders toont; zo hangt de kiosk alleen van zijn eigen adres af.
 *  Alleen media.cdr.nl (geen open proxy); lang gecachet, zodat Vercel elke hoes maar één keer ophaalt. */
export const HOES_HOST = 'media.cdr.nl'
app.get('/api/hoes', async (c) => {
  let url: URL
  try { url = new URL(c.req.query('u') ?? '') } catch { return c.json({ fout: 'Ongeldig adres' }, 400) }
  if (url.hostname !== HOES_HOST || !/^https?:$/.test(url.protocol) || !url.pathname.startsWith('/COVER/')) return c.json({ fout: 'Niet toegestaan' }, 400)
  url.protocol = 'https:'
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 10_000)
  try {
    const r = await haal('hoezen', url, { signal: ac.signal })
    const type = r.headers.get('content-type') ?? ''
    if (!r.ok || !type.startsWith('image/')) return c.json({ fout: 'Hoes niet gevonden' }, 404, { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' })
    return new Response(r.body, { headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=2592000, s-maxage=2592000, immutable',
    } })
  } catch {
    return c.json({ fout: 'Hoes tijdelijk niet bereikbaar' }, 502, { 'Cache-Control': 'no-store' })
  } finally { clearTimeout(t) }
})

/** Bestanden uit de privé Blob-store. Hoezen zijn voor iedereen; back-ups en uploads alleen voor beheerders. */
app.get('/api/bestand/*', async (c) => {
  const pad = decodeURIComponent(c.req.path.slice('/api/bestand/'.length))
  if (pad.includes('..') || !/^(hoezen|backups|uploads)\//.test(pad)) return c.json({ fout: 'Niet gevonden' }, 404)
  if (!pad.startsWith('hoezen/') && !gebruiker(c)?.rollen.includes('beheerder')) return c.json({ fout: 'Geen rechten' }, 403) // ook al in toegang.ts
  const r = await openBlob(pad)
  if (!r || r.statusCode !== 200) return c.json({ fout: 'Niet gevonden' }, 404)
  // Een "hoes" die geen afbeelding is, wordt nooit op ons eigen adres getoond (securityreview R2).
  if (pad.startsWith('hoezen/') && !/^image\/(jpeg|png|webp|gif)$/.test(r.blob.contentType ?? '')) return c.json({ fout: 'Niet gevonden' }, 404)
  return new Response(r.stream as any, { headers: {
    'Content-Type': r.blob.contentType ?? 'application/octet-stream',
    'Cache-Control': pad.startsWith('hoezen/') ? 'public, max-age=86400' : 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(pad.startsWith('hoezen/') ? {} : { 'Content-Disposition': `attachment; filename="${pad.split('/').pop()}"` }),
  } })
})

