// Testdata voor de browsertests (tests/e2e): een kleine fonotheek.db met albums en exemplaren, en een medewerker.
// Draait op PGlite in FONOS_DATA_DIR (standaard .e2e-data); wist die map eerst.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const data = resolve(process.env.FONOS_DATA_DIR ?? '.e2e-data')
rmSync(data, { recursive: true, force: true })
mkdirSync(data, { recursive: true })
process.env.FONOS_DATA_DIR = data
delete process.env.DATABASE_URL

const { db, zetInstelling } = await import('../server/db.ts')
const { laadFonotheek } = await import('../server/vulling.ts')
const { maakGebruiker } = await import('../server/auth.ts')
await db()

// Albums: zes popalbums van twee artiesten (één met tracklist) en twee klassieke.
const dir = mkdtempSync(join(tmpdir(), 'fonos-e2e-'))
const pad = join(dir, 'fonotheek.db')
const d = new DatabaseSync(pad)
d.exec(`
  CREATE TABLE albums (code TEXT PRIMARY KEY, title TEXT, media_description TEXT, number_of_discs INTEGER, release_date TEXT,
    released_before_1988 INTEGER NOT NULL DEFAULT 0, duration_seconds INTEGER, description TEXT, cover_url TEXT, back_cover_url TEXT);
  CREATE TABLE performers (code TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE album_performers (album_code TEXT, position INTEGER, performer_code TEXT);
  CREATE TABLE labels (code TEXT PRIMARY KEY, name TEXT, short_name TEXT);
  CREATE TABLE album_releases (album_code TEXT, label_code TEXT, label_number TEXT, ean TEXT, supplier TEXT);
  CREATE TABLE genres (code TEXT PRIMARY KEY, kind TEXT, name_nl TEXT);
  CREATE TABLE album_genres (album_code TEXT, genre_code TEXT);
  CREATE TABLE album_media (album_code TEXT, kind TEXT, media_code TEXT);
  CREATE TABLE works (code TEXT PRIMARY KEY, title TEXT, kind TEXT);
  CREATE TABLE work_composers (work_code TEXT, performer_code TEXT);
  CREATE TABLE tracks (track_id TEXT PRIMARY KEY, album_code TEXT, position INTEGER, title TEXT, duration_seconds INTEGER, work_code TEXT);
  CREATE TABLE track_performers (track_id TEXT, position INTEGER, performer_code TEXT, name TEXT, role TEXT);
  CREATE TABLE collectie_items (objectnummer TEXT, titelnummer TEXT, lijst TEXT);
  INSERT INTO performers VALUES ('M1', 'Herman van Veen'), ('M2', 'Suzanne Vega'), ('M3', 'Ludwig van Beethoven'), ('M4', 'Concertgebouworkest'), ('M5', 'No Artist');
  INSERT INTO labels VALUES ('L1', 'Philips', 'Philips');
  INSERT INTO genres VALUES ('T00000000102', 'stijl', 'Pop'), ('T00000000601', 'stijl', 'Symfonie');
  INSERT INTO works VALUES ('U1', 'Symfonie nr. 5', 'CLASSICAL');
  INSERT INTO work_composers VALUES ('U1', 'M3');
`)
const album = d.prepare('INSERT INTO albums VALUES (?, ?, ?, 1, ?, 0, ?, ?, NULL, NULL)')
const ap = d.prepare('INSERT INTO album_performers VALUES (?, 0, ?)')
const ag = d.prepare('INSERT INTO album_genres VALUES (?, ?)')
const rel = d.prepare("INSERT INTO album_releases VALUES (?, 'L1', '1', NULL, NULL)")
const col = d.prepare('INSERT INTO collectie_items VALUES (?, ?, ?)')
const titels = [
  ['HA01752', 'Herman van veen (ii)', 'M1'], ['HA01753', 'Carré', 'M1'], ['HA01754', 'Anne', 'M1'],
  ['JE01001', 'Solitude standing', 'M2'], ['JE01002', 'Days of open hand', 'M2'], ['LE00154', 'Stemmen des tijds - 1936', 'M5'],
]
titels.forEach(([code, titel, artiest], i) => {
  album.run(code, titel, '1 lp', `198${i}`, 2400, null)
  ap.run(code, artiest); ag.run(code, 'T00000000102'); rel.run(code)
  col.run(String(100000100 + i), code, 'Populair')
})
for (const [code, titel] of [['AB00547', 'Symfonie nr. 5'], ['AB00548', 'Symfonie nr. 6']]) {
  album.run(code, titel, '1 lp', '1975', 2100, 'Een klassieker.')
  ap.run(code, 'M3'); ag.run(code, 'T00000000601'); rel.run(code)
  col.run(String(200000000 + Number(code.slice(-1))), code, 'Klassiek')
}
// Eén album met een tracklist, voor de zoekreden "Nummer: ...".
d.exec(`INSERT INTO tracks VALUES ('HA01752-1', 'HA01752', 1, 'Cirkels (the windmills of your mind)', 200, NULL), ('HA01752-2', 'HA01752', 2, 'Suzanne', 180, NULL),
  ('AB00547-1', 'AB00547', 1, 'Allegro con brio', 480, 'U1');
  INSERT INTO track_performers VALUES ('AB00547-1', 0, 'M4', NULL, NULL);`)
d.close()
writeFileSync(pad + '.gz', gzipSync(readFileSync(pad)))
await laadFonotheek(pad + '.gz', () => {})
rmSync(dir, { recursive: true, force: true })

await zetInstelling('aantal_platenspelers', 4)
const { syncPlatenspelers } = await import('../server/db.ts')
await syncPlatenspelers(4)
await zetInstelling('tweestaps', 'iedereen')
await maakGebruiker({ email: 'e2e@fonotheek.test', naam: 'Test Medewerker', rollen: ['medewerker', 'beheerder', 'redacteur'], wachtwoord: 'e2e-wachtwoord-1' })
console.log(`[e2e] testdata klaar in ${data}`)
process.exit(0)
