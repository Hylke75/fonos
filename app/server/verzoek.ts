// Verzoekcontext (securityreview kandidaat 6): wat is ons adres, is dit HTTPS en wie is de client?
// Eén antwoord uit de configuratie, nooit uit headers die de client zelf kan invullen (Host, X-Forwarded-*).
import type { Context } from 'hono'

const LOKAAL = /^(localhost|127\.0\.0\.1|\[::1\])$/

/** Het adres van de app voor links in e-mails en voor Google. Uit FONOS_BASIS_URL; op Vercel het productieadres
 *  dat Vercel zelf zet; alleen bij een lokaal adres (ontwikkelen, tests) het adres van het verzoek. Anders: fout. */
export function basisUrl(c: Context): string {
  const ingesteld = process.env.FONOS_BASIS_URL?.replace(/\/+$/, '')
  if (ingesteld) return ingesteld
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  const u = new URL(c.req.url)
  if (LOKAAL.test(u.hostname)) return u.origin
  throw new Error('FONOS_BASIS_URL ontbreekt: stel het adres van de app in (bv. https://luisterbar.beeldengeluid.nl)')
}

/** Draait de app achter HTTPS? Op Vercel altijd; on-prem volgens FONOS_HTTPS (standaard aan in productie). */
export const isHttps = () => !!process.env.VERCEL || (process.env.NODE_ENV === 'production' && process.env.FONOS_HTTPS !== '0')

/** Het IP-adres van de client voor het aanmeldlog en de rem. Op Vercel zet Vercel x-real-ip zelf (niet te vervalsen);
 *  achter een eigen proxy alleen als FONOS_VERTROUWDE_PROXY=1 (die proxy moet X-Forwarded-For dan zelf zetten);
 *  anders het adres van de verbinding. */
export function clientIp(c: Context): string | null {
  if (process.env.VERCEL) return c.req.header('x-real-ip')?.trim() || null
  if (process.env.FONOS_VERTROUWDE_PROXY === '1') return (c.req.header('x-forwarded-for') ?? '').split(',')[0].trim() || null
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  return env?.incoming?.socket?.remoteAddress ?? null
}
