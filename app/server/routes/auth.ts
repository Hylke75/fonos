// Inloggen, uitloggen en wachtwoord-reset per e-mail (10.11), met tweestapsverificatie, inloggen via Google
// (de IDP) en een log van alle aanmeldingen (IT-beleid 6.1 en 6.3).
import { Hono, type Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { randomBytes } from 'node:crypto'
import {
  COOKIE, bevestigSessie, controleerInlog, gebruikerBijToken, gebruikerUitRij, isVerlopen, logout, maakResetToken, maakSessie,
  mislukteAanmeldingen, registreerAanmelding, resetWachtwoord, tweestapsNodig, vergrendeldeSessie, voorlopigeSessie, zetSessieCookie, controleerWachtwoord,
} from '../auth.ts'
import { get, instellingen, run } from '../db.ts'
import { stuurMail } from '../mail.ts'
import { meld } from '../meldingen.ts'
import { controleer, nieuwGeheim, otpauthUrl } from '../totp.ts'
import { googleAan, googleDomein, googleInlogAdres, googleTerug } from '../google.ts'

export const auth = new Hono()

const MAX_POGINGEN = 10 // per adres per kwartier (IT-beleid 6.1: rem op het raden van wachtwoorden)
const MAX_CODES = 5 // foute codes per voorlopige sessie

export const herkomst = (c: Context) => ({
  ip: (c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? '').split(',')[0].trim() || null,
  apparaat: c.req.header('user-agent') ?? null,
})

auth.get('/methoden', async (c) => {
  const inst = await instellingen()
  const google = googleAan()
  return c.json({ google, wachtwoord: !google || inst.wachtwoord_inloggen !== false, domein: google ? googleDomein() : null })
})

auth.post('/login', async (c) => {
  const { email, wachtwoord } = await c.req.json<{ email: string; wachtwoord: string }>()
  const adres = (email ?? '').trim()
  const h = herkomst(c)
  const inst = await instellingen()
  if (googleAan() && inst.wachtwoord_inloggen === false) return c.json({ fout: 'Log in met je Google-account van Beeld & Geluid.' }, 403)
  if (adres && (await mislukteAanmeldingen(adres)) >= MAX_POGINGEN) {
    await registreerAanmelding({ email: adres, gelukt: false, methode: 'wachtwoord', reden: 'geblokkeerd', ...h })
    return c.json({ fout: 'Te veel pogingen. Probeer het over een kwartier opnieuw.' }, 429)
  }
  const r = await controleerInlog(adres, wachtwoord ?? '')
  if ('reden' in r) {
    await registreerAanmelding({ email: adres, gebruikerId: r.g?.id, gelukt: false, methode: 'wachtwoord', reden: r.reden, ...h })
    const n = await mislukteAanmeldingen(adres)
    if (n >= MAX_POGINGEN && r.g) await meld(`inlogpogingen:${adres.toLowerCase()}`, 'Veel mislukte inlogpogingen',
      `Voor het account ${adres} zijn in het laatste kwartier ${n} inlogpogingen mislukt (laatste vanaf ${h.ip ?? 'onbekend adres'}). Het account is een kwartier geblokkeerd.`)
    // Alleen na een goed wachtwoord zeggen dat het account verlopen is; anders altijd dezelfde melding.
    if (r.reden === 'verlopen') return c.json({ fout: 'Je account is verlopen. Vraag verlenging aan via HR.' }, 401)
    return c.json({ fout: 'E-mailadres of wachtwoord klopt niet.' }, 401)
  }
  const g = r.g
  if (!tweestapsNodig(g, inst.tweestaps)) {
    zetSessieCookie(c, await maakSessie(g.id))
    await registreerAanmelding({ email: g.email, gebruikerId: g.id, gelukt: true, methode: 'wachtwoord', ...h })
    return c.json(gebruikerUitRij(g))
  }
  // Wachtwoord goed: nu de code uit de authenticator-app (of die eerst koppelen).
  zetSessieCookie(c, await maakSessie(g.id, false))
  if (g.totp_aan && g.totp_geheim) return c.json({ stap: 'code' })
  const geheim = nieuwGeheim()
  await run('UPDATE gebruikers SET totp_geheim = ?, totp_aan = 0, totp_laatste_stap = NULL WHERE id = ?', geheim, g.id)
  return c.json({ stap: 'koppelen', geheim, otpauth: otpauthUrl(geheim, g.email) })
})

auth.post('/code', async (c) => {
  const { code } = await c.req.json<{ code: string }>()
  const h = herkomst(c)
  const v = await voorlopigeSessie(getCookie(c, COOKIE))
  if (!v) return c.json({ fout: 'Je sessie is verlopen. Log opnieuw in.' }, 401)
  const { g, sessie } = v
  const stap = g.totp_geheim ? controleer(g.totp_geheim, code, Date.now(), g.totp_laatste_stap) : null
  if (stap == null) {
    await registreerAanmelding({ email: g.email, gebruikerId: g.id, gelukt: false, methode: 'tweede_stap', reden: 'code', ...h })
    if (sessie.pogingen + 1 >= MAX_CODES) {
      await run('DELETE FROM sessies WHERE token = ?', sessie.token)
      deleteCookie(c, COOKIE, { path: '/' })
      return c.json({ fout: 'Te vaak een verkeerde code. Log opnieuw in.' }, 401)
    }
    await run('UPDATE sessies SET pogingen = pogingen + 1 WHERE token = ?', sessie.token)
    return c.json({ fout: 'Deze code klopt niet. Kijk of de tijd op je telefoon goed staat.' }, 400)
  }
  await run('UPDATE gebruikers SET totp_aan = 1, totp_laatste_stap = ? WHERE id = ?', stap, g.id)
  await bevestigSessie(sessie.token)
  zetSessieCookie(c, sessie.token)
  await registreerAanmelding({ email: g.email, gebruikerId: g.id, gelukt: true, methode: 'tweede_stap', reden: g.totp_aan ? null : 'gekoppeld', ...h })
  return c.json(gebruikerUitRij(g))
})

// ------------------------------------------------------------------ inloggen via Google (OpenID Connect)

const OIDC_COOKIE = 'fonos_oidc'
const veiligTerug = (p?: string | null) => (p && /^\/(medewerker|beheer)(\/[\w\-/?=&%.]*)?$/.test(p) ? p : '/beheer')

auth.get('/google', async (c) => {
  if (!googleAan()) return c.json({ fout: 'Inloggen via Google is niet ingesteld' }, 404)
  const state = randomBytes(24).toString('hex')
  const nonce = randomBytes(24).toString('hex')
  const terug = veiligTerug(c.req.query('terug'))
  setCookie(c, OIDC_COOKIE, JSON.stringify({ state, nonce, terug }), {
    httpOnly: true, sameSite: 'Lax', path: '/api/auth', maxAge: 600, secure: new URL(c.req.url).protocol === 'https:',
  })
  return c.redirect(googleInlogAdres(c, state, nonce))
})

auth.get('/google/terug', async (c) => {
  const h = herkomst(c)
  let opgeslagen: { state: string; nonce: string; terug: string } | null = null
  try { opgeslagen = JSON.parse(getCookie(c, OIDC_COOKIE) ?? 'null') } catch { /* leeg */ }
  deleteCookie(c, OIDC_COOKIE, { path: '/api/auth' })
  const terug = veiligTerug(opgeslagen?.terug)
  const fout = (tekst: string) => c.redirect(`${terug}${terug.includes('?') ? '&' : '?'}login_fout=${encodeURIComponent(tekst)}`)
  if (!opgeslagen || c.req.query('state') !== opgeslagen.state) return fout('Het inloggen via Google is verlopen. Probeer het opnieuw.')
  if (c.req.query('error') || !c.req.query('code')) return fout('Inloggen via Google is afgebroken.')
  const r = await googleTerug(c, c.req.query('code')!, opgeslagen.nonce).catch((e) => ({ fout: String(e?.message ?? e) }))
  if ('fout' in r) {
    await registreerAanmelding({ email: (r as any).email ?? null, gelukt: false, methode: 'google', reden: 'domein', ...h })
    return fout(r.fout)
  }
  const g = await get<any>('SELECT * FROM gebruikers WHERE lower(email) = lower(?)', r.email)
  if (!g || !g.actief || isVerlopen(g)) {
    const reden = !g ? 'onbekend' : !g.actief ? 'inactief' : 'verlopen'
    await registreerAanmelding({ email: r.email, gebruikerId: g?.id, gelukt: false, methode: 'google', reden, ...h })
    return fout(reden === 'verlopen' ? 'Je account is verlopen. Vraag verlenging aan via HR.'
      : `Er is geen actief Fonotheek-account voor ${r.email}. Vraag een beheerder om je toe te voegen.`)
  }
  // Google Workspace van B&G dwingt zelf tweestapsverificatie af: geen tweede code nodig.
  zetSessieCookie(c, await maakSessie(g.id))
  await registreerAanmelding({ email: g.email, gebruikerId: g.id, gelukt: true, methode: 'google', ...h })
  return c.redirect(terug)
})

// ------------------------------------------------------------------ uitloggen, sessie, wachtwoord

auth.post('/logout', async (c) => {
  const g = await gebruikerBijToken(getCookie(c, COOKIE))
  await logout(c)
  if (g) await registreerAanmelding({ email: g.email, gebruikerId: g.id, gelukt: true, methode: 'uitloggen', ...herkomst(c) })
  return c.json({ ok: true })
})

auth.get('/ik', async (c) => {
  const g = await gebruikerBijToken(getCookie(c, COOKIE))
  const inst = await instellingen()
  const inactief = { beheer_min: Number(inst.beheer_uitloggen_min) || 0, medewerker_min: Number(inst.medewerker_vergrendel_min) || 0 }
  if (g) return c.json({ ...g, inactief })
  const v = await vergrendeldeSessie(getCookie(c, COOKIE))
  if (v) return c.json({ fout: 'Vergrendeld', vergrendeld: { naam: v.naam, email: v.email, met: v.totp_aan && v.totp_geheim ? 'code' : 'wachtwoord' } }, 401)
  return c.json({ fout: 'Niet ingelogd' }, 401)
})

// Vergrendelen na inactiviteit (IT-beleid 8.5) en ontgrendelen met de code of het wachtwoord.
auth.post('/vergrendel', async (c) => {
  const token = getCookie(c, COOKIE)
  if (token) await run('UPDATE sessies SET vergrendeld = 1 WHERE token = ? AND bevestigd = 1', token)
  return c.json({ ok: true })
})
auth.post('/ontgrendel', async (c) => {
  const { code, wachtwoord } = await c.req.json<{ code?: string; wachtwoord?: string }>()
  const token = getCookie(c, COOKIE)
  const g = await vergrendeldeSessie(token)
  if (!g || !token) return c.json({ fout: 'Je sessie is verlopen. Log opnieuw in.' }, 401)
  const h = herkomst(c)
  if ((await mislukteAanmeldingen(g.email)) >= MAX_POGINGEN) return c.json({ fout: 'Te veel pogingen. Log over een kwartier opnieuw in.' }, 429)
  let ok = false
  if (g.totp_aan && g.totp_geheim) {
    const stap = controleer(g.totp_geheim, code ?? '', Date.now(), g.totp_laatste_stap)
    if (stap != null) { ok = true; await run('UPDATE gebruikers SET totp_laatste_stap = ? WHERE id = ?', stap, g.id) }
  } else ok = controleerWachtwoord(wachtwoord ?? '', g.wachtwoord)
  await registreerAanmelding({ email: g.email, gebruikerId: g.id, gelukt: ok, methode: 'ontgrendelen', reden: ok ? null : g.totp_aan ? 'code' : 'wachtwoord', ...h })
  if (!ok) return c.json({ fout: g.totp_aan ? 'Deze code klopt niet.' : 'Dit wachtwoord klopt niet.' }, 400)
  await run('UPDATE sessies SET vergrendeld = 0 WHERE token = ?', token)
  return c.json(gebruikerUitRij(g))
})

auth.post('/reset-aanvraag', async (c) => {
  const { email } = await c.req.json<{ email: string }>()
  const g = await get<any>('SELECT * FROM gebruikers WHERE lower(email) = lower(?) AND actief = 1', (email ?? '').trim())
  if (g && !isVerlopen(g)) {
    const token = await maakResetToken(g.id)
    const basis = process.env.FONOS_BASIS_URL ?? new URL(c.req.url).origin
    await stuurMail(g.email, 'Nieuw wachtwoord voor de Fonotheek', `Kies een nieuw wachtwoord via deze link (2 uur geldig):\n${basis}/wachtwoord?token=${token}`).catch((e) => console.error(e))
  }
  // Altijd hetzelfde antwoord: verraad niet welke adressen bestaan.
  return c.json({ ok: true })
})

auth.post('/reset', async (c) => {
  const { token, wachtwoord } = await c.req.json<{ token: string; wachtwoord: string }>()
  if (!wachtwoord || wachtwoord.length < 10) return c.json({ fout: 'Kies een wachtwoord van minstens 10 tekens.' }, 400)
  return await resetWachtwoord(token ?? '', wachtwoord) ? c.json({ ok: true }) : c.json({ fout: 'Deze link is verlopen of al gebruikt.' }, 400)
})
