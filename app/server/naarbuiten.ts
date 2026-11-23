// Uitgaande verbindingen (securityreview kandidaat 3): alles wat de server zelf ophaalt of verstuurt, gaat hierlangs.
// Per bestemming staat vast welke hosts mogen; altijd HTTPS, geen redirects en een time-out. Deze lijst is ook de
// firewalltabel voor een afgeschermde (on-prem) omgeving. Een nieuwe koppeling = een nieuwe bestemming hier.
// (Pushmeldingen gaan via de bibliotheek web-push; de toegestane push-diensten staan in PUSH_HOSTS en worden bij het
// aanmelden van een apparaat gecontroleerd.)

export type Bestemming = 'hoezen' | 'google' | 'mail' | 'nieuwsbrief' | 'opslag'

const BLOB = (h: string) => h.endsWith('.blob.vercel-storage.com')
const PRIVE = /^(localhost|.*\.local|.*\.internal|\d+\.\d+\.\d+\.\d+|\[.*\])$/i // geen IP-adressen of interne namen

export const BESTEMMINGEN: Record<Bestemming, { hosts: string; mag: (host: string) => boolean }> = {
  hoezen: { hosts: 'media.cdr.nl, *.blob.vercel-storage.com', mag: (h) => h === 'media.cdr.nl' || BLOB(h) },
  google: { hosts: 'oauth2.googleapis.com', mag: (h) => h === 'oauth2.googleapis.com' },
  mail: { hosts: 'api.resend.com', mag: (h) => h === 'api.resend.com' },
  // Het adres stelt een beheerder in (Instellingen → Nieuwsbrief); geen IP-adressen of interne namen.
  nieuwsbrief: { hosts: '(ingesteld webhook-adres)', mag: (h) => !PRIVE.test(h) },
  opslag: { hosts: '*.blob.vercel-storage.com', mag: BLOB },
}

/** Push-diensten van de browsers (Chrome/Edge/Android, Firefox, Safari, Windows). */
export const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/]
export const magPush = (endpoint: string) => {
  try { const u = new URL(endpoint); return u.protocol === 'https:' && PUSH_HOSTS.some((r) => r.test(u.hostname)) } catch { return false }
}

export class NietToegestaan extends Error {}

/** Mag de server dit adres voor deze bestemming ophalen? */
export function magNaar(b: Bestemming, adres: string | URL): boolean {
  try {
    const u = new URL(adres)
    return u.protocol === 'https:' && !u.username && !u.password && BESTEMMINGEN[b].mag(u.hostname.toLowerCase())
  } catch { return false }
}

/** fetch, maar alleen naar een toegestane host, zonder redirects en met een time-out (standaard 10 s). */
export async function haal(b: Bestemming, adres: string | URL, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  if (!magNaar(b, adres)) throw new NietToegestaan(`Uitgaand verzoek naar ${new URL(adres).hostname} is niet toegestaan (${b})`)
  const { timeoutMs = 10_000, signal, ...rest } = init
  const tijd = AbortSignal.timeout(timeoutMs)
  return fetch(adres, { ...rest, redirect: 'error', signal: signal ? AbortSignal.any([signal, tijd]) : tijd })
}
