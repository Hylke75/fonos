/** Muziekweb-hoezen (media.cdr.nl) via de eigen server laden (/api/hoes): sommige netwerken laden media.cdr.nl
 *  niet, en dan zou de kiosk alleen placeholders tonen. Andere adressen (eigen uploads, Spotify) blijven ongewijzigd. */
export function viaApp(src: string): string
export function viaApp(src: string | null | undefined): string | null | undefined
export function viaApp(src: string | null | undefined) {
  if (!src || !/^https?:\/\/media\.cdr\.nl\//i.test(src)) return src
  return `/api/hoes?u=${encodeURIComponent(src.replace(/^http:/i, 'https:'))}`
}
