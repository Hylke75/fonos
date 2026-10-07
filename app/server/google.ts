// Inloggen via Google Workspace van Beeld & Geluid (IT-beleid 6.1: de IDP heeft de voorkeur).
// Aan zodra GOOGLE_CLIENT_ID en GOOGLE_CLIENT_SECRET zijn gezet (OAuth-client van het type "Webtoepassing",
// redirect-URI <basis>/api/auth/google/terug). Alleen adressen uit FONOS_GOOGLE_DOMEIN (standaard beeldengeluid.nl).
import type { Context } from 'hono'

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'

export const googleAan = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
export const googleDomein = () => (process.env.FONOS_GOOGLE_DOMEIN ?? 'beeldengeluid.nl').toLowerCase()

const terugAdres = (c: Context) => `${process.env.FONOS_BASIS_URL ?? new URL(c.req.url).origin}/api/auth/google/terug`

export function googleInlogAdres(c: Context, state: string, nonce: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: terugAdres(c), response_type: 'code',
    scope: 'openid email profile', state, nonce, hd: googleDomein(), prompt: 'select_account',
  })
  return `${AUTH}?${q}`
}

/** Leest de claims uit een id_token. Het token komt rechtstreeks van Google via TLS (met ons client secret),
 *  dus de handtekening hoeft niet apart gecontroleerd te worden (OpenID Connect Core 3.1.3.7). */
export function claims(idToken: string): Record<string, any> {
  const deel = idToken.split('.')[1]
  if (!deel) throw new Error('Ongeldig id_token')
  return JSON.parse(Buffer.from(deel, 'base64url').toString('utf8'))
}

/** Controleert de claims; geeft het e-mailadres of een foutmelding. */
export function controleerClaims(cl: Record<string, any>, nonce: string, nu = Date.now()): { email: string } | { fout: string; email?: string } {
  const email = String(cl.email ?? '').toLowerCase()
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(cl.iss)) return { fout: 'Onbekende uitgever van het token.' }
  if (cl.aud !== process.env.GOOGLE_CLIENT_ID) return { fout: 'Het token is niet voor deze app.' }
  if (!cl.exp || cl.exp * 1000 < nu) return { fout: 'Het token is verlopen. Probeer het opnieuw.' }
  if (cl.nonce !== nonce) return { fout: 'Het inloggen via Google is verlopen. Probeer het opnieuw.' }
  if (!email || cl.email_verified !== true) return { fout: 'Je e-mailadres bij Google is niet bevestigd.', email }
  const domein = googleDomein()
  if (String(cl.hd ?? '').toLowerCase() !== domein || !email.endsWith(`@${domein}`)) return { fout: `Log in met je account van ${domein}.`, email }
  return { email }
}

export async function googleTerug(c: Context, code: string, nonce: string): Promise<{ email: string } | { fout: string; email?: string }> {
  const r = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: terugAdres(c), grant_type: 'authorization_code',
    }),
  })
  if (!r.ok) return { fout: 'Google weigerde het inloggen. Probeer het opnieuw.' }
  const t = await r.json() as { id_token?: string }
  if (!t.id_token) return { fout: 'Google gaf geen identiteit terug.' }
  return controleerClaims(claims(t.id_token), nonce)
}
