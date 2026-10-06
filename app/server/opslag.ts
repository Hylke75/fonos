// Bestandsopslag voor geüploade hoezen en back-ups, los van de database (12.3, 14).
// Op Vercel: Vercel Blob (BLOB_READ_WRITE_TOKEN). Lokaal: een map op schijf, geserveerd via /uploads.
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync, statSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DATA_DIR } from './db.ts'

export const OPSLAG_DIR = process.env.FONOS_OPSLAG_DIR ?? join(DATA_DIR, 'opslag')
const blob = () => !!process.env.BLOB_READ_WRITE_TOKEN
/** De Blob-store is privé (standaard): bestanden gaan via /api/bestand/…, met rechtencontrole voor back-ups. */
export const BLOB_TOEGANG = (process.env.FONOS_BLOB_ACCESS === 'public' ? 'public' : 'private') as 'public' | 'private'
export const BESTAND_PREFIX = '/api/bestand/'

/** Slaat een bestand op en geeft het adres terug, met een onraadbare naam. */
export async function bewaar(map: 'hoezen' | 'backups' | 'uploads', naam: string, data: Buffer, type: string): Promise<string> {
  const veilig = `${randomUUID()}-${basename(naam).replace(/[^\w.-]/g, '_')}`
  if (blob()) {
    const { put } = await import('@vercel/blob')
    const r = await put(`${map}/${veilig}`, data, { access: BLOB_TOEGANG, contentType: type, addRandomSuffix: false })
    return BLOB_TOEGANG === 'public' ? r.url : BESTAND_PREFIX + r.pathname
  }
  const pad = join(OPSLAG_DIR, map, veilig)
  mkdirSync(dirname(pad), { recursive: true })
  writeFileSync(pad, data)
  return `/uploads/${map}/${veilig}`
}

/** Opent een bestand uit Vercel Blob als stroom (voor /api/bestand). */
export async function openBlob(pathOfUrl: string) {
  const { get } = await import('@vercel/blob')
  return get(pathOfUrl, { access: BLOB_TOEGANG })
}

export async function lees(adres: string): Promise<Buffer> {
  if (adres.startsWith(BESTAND_PREFIX) || (blob() && /\.blob\.vercel-storage\.com\//.test(adres))) {
    const r = await openBlob(adres.startsWith(BESTAND_PREFIX) ? adres.slice(BESTAND_PREFIX.length) : adres)
    if (!r) throw new Error('Bestand niet gevonden in de opslag')
    return Buffer.from(await new Response(r.stream as any).arrayBuffer())
  }
  if (/^https?:\/\//.test(adres)) {
    const r = await fetch(adres)
    if (!r.ok) throw new Error(`Bestand niet te lezen (${r.status})`)
    return Buffer.from(await r.arrayBuffer())
  }
  return readFileSync(lokaalPad(adres))
}

export async function verwijder(adres: string) {
  if (adres.startsWith(BESTAND_PREFIX)) {
    if (blob()) { const { del } = await import('@vercel/blob'); await del(adres.slice(BESTAND_PREFIX.length)).catch(() => {}) }
    return
  }
  if (/^https?:\/\//.test(adres)) {
    if (blob()) { const { del } = await import('@vercel/blob'); await del(adres).catch(() => {}) }
    return
  }
  const p = lokaalPad(adres)
  if (existsSync(p)) unlinkSync(p)
}

/** Zet een bestand terug op precies hetzelfde adres als het ontbreekt (terugzetten van een back-up). */
export async function zetTerugOpAdres(adres: string, data: Buffer) {
  if (!blob() || !adres.startsWith(BESTAND_PREFIX)) return false // openbare Blob-adressen hebben een willekeurig deel: niet na te maken
  const pad = adres.slice(BESTAND_PREFIX.length)
  const { head, put } = await import('@vercel/blob')
  if (await head(pad).then(() => true, () => false)) return false
  const type = /\.png$/i.test(pad) ? 'image/png' : /\.webp$/i.test(pad) ? 'image/webp' : 'image/jpeg'
  await put(pad, data, { access: BLOB_TOEGANG, contentType: type, addRandomSuffix: false })
  return true
}

/** Verwijdert tijdelijke bestanden in de map uploads (downloads, geüploade imports) die ouder zijn dan maxLeeftijd. */
export async function ruimUploadsOp(maxLeeftijd: number) {
  const grens = Date.now() - maxLeeftijd
  if (blob()) {
    const { list, del } = await import('@vercel/blob')
    let cursor: string | undefined
    do {
      const r = await list({ prefix: 'uploads/', cursor, limit: 1000 })
      const oud = r.blobs.filter((b) => new Date(b.uploadedAt).getTime() < grens).map((b) => b.url)
      if (oud.length) await del(oud)
      cursor = r.hasMore ? r.cursor : undefined
    } while (cursor)
    return
  }
  const d = join(OPSLAG_DIR, 'uploads')
  for (const f of lokaleBestanden('uploads')) if (statSync(join(d, f)).mtimeMs < grens) unlinkSync(join(d, f))
}

export function lokaalPad(adres: string) {
  const rel = adres.replace(/^\/uploads\//, '')
  if (rel.includes('..')) throw new Error('Ongeldig pad')
  return join(OPSLAG_DIR, rel)
}

/** Door Fonos geüploade hoezen: de adressen die in de database voorkomen. */
export function isEigenUpload(adres?: string | null) {
  return !!adres && (adres.startsWith('/uploads/') || adres.startsWith(BESTAND_PREFIX) || /\.blob\.vercel-storage\.com\//.test(adres))
}

export function lokaleBestanden(map: string): string[] {
  const d = join(OPSLAG_DIR, map)
  if (!existsSync(d)) return []
  return readdirSync(d).filter((f) => statSync(join(d, f)).isFile())
}
