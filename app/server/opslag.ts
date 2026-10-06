// Bestandsopslag voor geüploade hoezen en back-ups, los van de database (12.3, 14).
// Op Vercel: Vercel Blob (BLOB_READ_WRITE_TOKEN). Lokaal: een map op schijf, geserveerd via /uploads.
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync, statSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DATA_DIR } from './db.ts'

export const OPSLAG_DIR = process.env.FONOS_OPSLAG_DIR ?? join(DATA_DIR, 'opslag')
const blob = () => !!process.env.BLOB_READ_WRITE_TOKEN

/** Slaat een bestand op en geeft het adres terug (publiek, met onraadbare naam). */
export async function bewaar(map: 'hoezen' | 'backups' | 'uploads', naam: string, data: Buffer, type: string): Promise<string> {
  const veilig = `${randomUUID()}-${basename(naam).replace(/[^\w.-]/g, '_')}`
  if (blob()) {
    const { put } = await import('@vercel/blob')
    const r = await put(`${map}/${veilig}`, data, { access: 'public', contentType: type, addRandomSuffix: true })
    return r.url
  }
  const pad = join(OPSLAG_DIR, map, veilig)
  mkdirSync(dirname(pad), { recursive: true })
  writeFileSync(pad, data)
  return `/uploads/${map}/${veilig}`
}

export async function lees(adres: string): Promise<Buffer> {
  if (/^https?:\/\//.test(adres)) {
    const r = await fetch(adres)
    if (!r.ok) throw new Error(`Bestand niet te lezen (${r.status})`)
    return Buffer.from(await r.arrayBuffer())
  }
  return readFileSync(lokaalPad(adres))
}

export async function verwijder(adres: string) {
  if (/^https?:\/\//.test(adres)) {
    if (blob()) { const { del } = await import('@vercel/blob'); await del(adres).catch(() => {}) }
    return
  }
  const p = lokaalPad(adres)
  if (existsSync(p)) unlinkSync(p)
}

export function lokaalPad(adres: string) {
  const rel = adres.replace(/^\/uploads\//, '')
  if (rel.includes('..')) throw new Error('Ongeldig pad')
  return join(OPSLAG_DIR, rel)
}

/** Door Fonos geüploade hoezen: de adressen die in de database voorkomen. */
export function isEigenUpload(adres?: string | null) {
  return !!adres && (adres.startsWith('/uploads/') || /\.public\.blob\.vercel-storage\.com\//.test(adres))
}

export function lokaleBestanden(map: string): string[] {
  const d = join(OPSLAG_DIR, map)
  if (!existsSync(d)) return []
  return readdirSync(d).filter((f) => statSync(join(d, f)).isFile())
}
