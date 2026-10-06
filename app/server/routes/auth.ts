// Inloggen, uitloggen en wachtwoord-reset per e-mail (10.11).
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { COOKIE, gebruikerBijToken, login, logout, maakResetToken, resetWachtwoord, zetSessieCookie } from '../auth.ts'
import { get } from '../db.ts'
import { stuurMail } from '../mail.ts'

export const auth = new Hono()

// Eenvoudige rem op raden van wachtwoorden: max 10 pogingen per kwartier per adres.
const pogingen = new Map<string, { n: number; sinds: number }>()

auth.post('/login', async (c) => {
  const { email, wachtwoord } = await c.req.json<{ email: string; wachtwoord: string }>()
  const sleutel = (email ?? '').toLowerCase()
  const p = pogingen.get(sleutel)
  if (p && Date.now() - p.sinds < 15 * 60_000 && p.n >= 10) return c.json({ fout: 'Te veel pogingen. Probeer het over een kwartier opnieuw.' }, 429)
  const r = login(email ?? '', wachtwoord ?? '')
  if (!r) {
    pogingen.set(sleutel, p && Date.now() - p.sinds < 15 * 60_000 ? { n: p.n + 1, sinds: p.sinds } : { n: 1, sinds: Date.now() })
    return c.json({ fout: 'E-mailadres of wachtwoord klopt niet.' }, 401)
  }
  pogingen.delete(sleutel)
  zetSessieCookie(c, r.token)
  return c.json(r.gebruiker)
})

auth.post('/logout', (c) => { logout(c); return c.json({ ok: true }) })

auth.get('/ik', (c) => {
  const g = gebruikerBijToken(getCookie(c, COOKIE))
  return g ? c.json(g) : c.json({ fout: 'Niet ingelogd' }, 401)
})

auth.post('/reset-aanvraag', async (c) => {
  const { email } = await c.req.json<{ email: string }>()
  const g = get<any>('SELECT * FROM gebruikers WHERE email = ? AND actief = 1', (email ?? '').trim())
  if (g) {
    const token = maakResetToken(g.id)
    const basis = process.env.FONOS_BASIS_URL ?? new URL(c.req.url).origin
    await stuurMail(g.email, 'Nieuw wachtwoord voor de Fonotheek', `Kies een nieuw wachtwoord via deze link (2 uur geldig):\n${basis}/wachtwoord?token=${token}`).catch((e) => console.error(e))
  }
  // Altijd hetzelfde antwoord: verraad niet welke adressen bestaan.
  return c.json({ ok: true })
})

auth.post('/reset', async (c) => {
  const { token, wachtwoord } = await c.req.json<{ token: string; wachtwoord: string }>()
  if (!wachtwoord || wachtwoord.length < 10) return c.json({ fout: 'Kies een wachtwoord van minstens 10 tekens.' }, 400)
  return resetWachtwoord(token ?? '', wachtwoord) ? c.json({ ok: true }) : c.json({ fout: 'Deze link is verlopen of al gebruikt.' }, 400)
})
