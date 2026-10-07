// Koppelt titels aan Spotify-albums. Hervatbaar: alleen zichtbare titels met status 'nog_niet'.
//
//   npm run spotify:koppel -- --proef 150             proef op 150 willekeurige titels, schrijft NIETS (rapport)
//   npm run spotify:koppel -- --proef 150 --schrijf   idem, maar slaat de uitkomst op
//   npm run spotify:koppel -- --alles [--max 2000] [--max-minuten 50]   de hele collectie (of hooguit N titels/minuten), slaat alles op
//
// Nodig: DATABASE_URL, SPOTIFY_CLIENT_ID en SPOTIFY_CLIENT_SECRET (uit .env.local of de omgeving).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// .env.local inlezen (zonder extra pakket); bestaande omgevingsvariabelen gaan voor.
const envBestand = join(import.meta.dirname, '..', '.env.local')
if (existsSync(envBestand)) {
  for (const regel of readFileSync(envBestand, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(regel)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const { db } = await import('../server/db.ts')
const { beoordeel, instellingenVoorKoppelen, proefTitels, slaOp, tellingen, volgendeTitels } = await import('../server/spotify/koppel.ts')
const { heeftSleutels } = await import('../server/spotify/client.ts')

const arg = (naam: string) => { const i = process.argv.indexOf(naam); return i >= 0 ? process.argv[i + 1] : undefined }
const proef = arg('--proef') ? Number(arg('--proef')) : null
const alles = process.argv.includes('--alles')
const schrijf = alles || process.argv.includes('--schrijf')
const max = arg('--max') ? Number(arg('--max')) : Infinity
// Tijdslimiet (voor de geplande GitHub Action): netjes stoppen; de volgende run gaat verder waar deze stopte.
const eindtijd = arg('--max-minuten') ? Date.now() + Number(arg('--max-minuten')) * 60_000 : Infinity
const rapportPad = arg('--rapport') ?? 'spotify-rapport.json'

if (!heeftSleutels()) { console.error('SPOTIFY_CLIENT_ID en SPOTIFY_CLIENT_SECRET ontbreken.'); process.exit(1) }
if (!proef && !alles) { console.error('Gebruik --proef N of --alles.'); process.exit(1) }

await db()
const { generiek, klassiek } = await instellingenVoorKoppelen()
const telling: Record<string, number> = { auto_goed: 0, twijfel: 0, geen: 0, uitgesloten: 0 }
const uitkomsten: any[] = []
let verzoeken = 0
let gedaan = 0
const t0 = Date.now()

const verwerk = async (titels: any[]) => {
  for (const t of titels) {
    if (gedaan >= max || Date.now() >= eindtijd) return false
    const u = await beoordeel(t, generiek, klassiek)
    verzoeken += u.zoekopdrachten
    telling[u.status]++
    gedaan++
    if (schrijf) await slaOp(u)
    if (proef) uitkomsten.push(u)
    if (gedaan % 25 === 0) console.log(`  ${gedaan} titels, ${verzoeken} zoekopdrachten, ${Math.round((Date.now() - t0) / 1000)} s — ${JSON.stringify(telling)}`)
  }
  return true
}

if (proef) await verwerk(await proefTitels(proef))
else {
  for (;;) {
    const reeks = await volgendeTitels(50)
    if (!reeks.length || !(await verwerk(reeks))) break
  }
}

console.log(`\nKlaar: ${gedaan} titels in ${Math.round((Date.now() - t0) / 1000)} s, ${verzoeken} zoekopdrachten${schrijf ? '' : ' (proef: niets opgeslagen)'}.`)
console.log('Per status:', telling)
if (schrijf) console.log('Stand van de hele collectie:', await tellingen())
if (proef) {
  writeFileSync(rapportPad, JSON.stringify({ telling, uitkomsten }, null, 2))
  console.log(`Rapport: ${rapportPad}`)
}
process.exit(0)
