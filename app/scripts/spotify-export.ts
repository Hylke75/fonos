// Schrijft de Spotify-koppelingen uit de (lokale) database naar spotify/koppelingen.jsonl.gz in de repo.
// De Vercel-build leest dit bestand in (scripts/vercel-vul.ts) en zet de koppelingen in productie,
// alleen bij titels die daar nog op 'nog_niet' staan. Sleutel: titelnummer.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'

const { db, all } = await import('../server/db.ts')
await db()
const rijen = await all<any>(`SELECT titelnummer AS tn, spotify_status AS s, spotify_album_id AS a, spotify_score AS sc, spotify_kandidaat AS k, spotify_gecontroleerd_op AS g
  FROM titels WHERE titelnummer IS NOT NULL AND spotify_status IN ('auto_goed', 'twijfel', 'geen', 'uitgesloten') ORDER BY titelnummer`)
const pad = join(import.meta.dirname, '..', '..', 'spotify', 'koppelingen.jsonl.gz')
mkdirSync(dirname(pad), { recursive: true })
writeFileSync(pad, gzipSync(rijen.map((r) => JSON.stringify({ ...r, sc: r.sc == null ? null : Number(r.sc) })).join('\n')))
console.log(`${rijen.length} koppelingen geschreven naar ${pad}`)
process.exit(0)
