// Spotify Web API met de Client Credentials-flow (geen gebruikerslogin). Alleen server-side.
// Sleutels uit SPOTIFY_CLIENT_ID en SPOTIFY_CLIENT_SECRET; nooit in code of commits.
// Development Mode: zoeken met hooguit 10 resultaten, rustig tempo (± 1 verzoek per seconde), 429 met Retry-After afhandelen.

type Token = { waarde: string; geldigTot: number }
let token: Token | null = null
let laatsteVerzoek = 0
const TUSSENPOOS_MS = Number(process.env.SPOTIFY_TUSSENPOOS_MS ?? 1000)

const slaap = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function heeftSleutels() {
  return !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET)
}

async function haalToken(): Promise<string> {
  if (token && Date.now() < token.geldigTot - 60_000) return token.waarde
  if (!heeftSleutels()) throw new Error('SPOTIFY_CLIENT_ID en SPOTIFY_CLIENT_SECRET ontbreken')
  const basis = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basis}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  if (!r.ok) throw new Error(`Spotify-token niet gekregen (${r.status})`)
  const d = (await r.json()) as { access_token: string; expires_in: number }
  token = { waarde: d.access_token, geldigTot: Date.now() + d.expires_in * 1000 }
  return token.waarde
}

/** GET op de Web API, met vast tempo, Retry-After bij 429 en exponential backoff bij storingen. */
export async function spotifyGet<T = any>(pad: string, poging = 0): Promise<T> {
  const wacht = laatsteVerzoek + TUSSENPOOS_MS - Date.now()
  if (wacht > 0) await slaap(wacht)
  laatsteVerzoek = Date.now()
  let r: Response
  try {
    r = await fetch(`https://api.spotify.com/v1${pad}`, { headers: { Authorization: `Bearer ${await haalToken()}` } })
  } catch (e) {
    if (poging >= 5) throw e
    await slaap(2 ** poging * 2000)
    return spotifyGet(pad, poging + 1)
  }
  if (r.status === 401 && poging < 1) { token = null; return spotifyGet(pad, poging + 1) }
  if (r.status === 429 || r.status >= 500) {
    if (poging >= 6) throw new Error(`Spotify antwoordt ${r.status}, ook na ${poging} pogingen`)
    const na = Number(r.headers.get('retry-after'))
    const ms = Number.isFinite(na) && na > 0 ? na * 1000 : 2 ** poging * 2000
    console.warn(`[spotify] ${r.status}: ${Math.round(ms / 1000)} s wachten (poging ${poging + 1})`)
    await slaap(ms + Math.random() * 500)
    return spotifyGet(pad, poging + 1)
  }
  if (!r.ok) throw new Error(`Spotify antwoordt ${r.status} op ${pad.split('?')[0]}`)
  return (await r.json()) as T
}

export type SpotifyAlbum = { id: string; name: string; album_type?: string; artists: { name: string }[]; release_date?: string; images?: { url: string; width?: number | null }[] }

/** Albums zoeken, markt NL, hooguit 10 resultaten (grens van Development Mode). */
export async function zoekAlbums(q: string): Promise<SpotifyAlbum[]> {
  const d = await spotifyGet<{ albums?: { items: (SpotifyAlbum | null)[] } }>(`/search?${new URLSearchParams({ q, type: 'album', market: 'NL', limit: '10' })}`)
  return (d.albums?.items ?? []).filter((x): x is SpotifyAlbum => !!x)
}
