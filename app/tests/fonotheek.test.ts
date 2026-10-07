// fonotheek.db(.gz): de lezer levert dezelfde records als de oude exports, en de vulling laadt albums en collectie.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

process.env.NODE_ENV = 'test'
process.env.FONOS_OPSLAG_DIR = mkdtempSync(join(tmpdir(), 'fonos-test-opslag-'))
delete process.env.DATABASE_URL

const { useMemoryDb, get, all } = await import('../server/db.ts')
const { leesFonotheekDb, duurUit, kiesLezer } = await import('../server/importers/muziekweb-lezers.ts')
const { laadFonotheek } = await import('../server/vulling.ts')
await useMemoryDb()

const dir = mkdtempSync(join(tmpdir(), 'fonos-test-fdb-'))

/** Een kleine fonotheek.db met één popalbum, één klassiek album en drie exemplaren. */
function maakDb(pad: string, extra = false) {
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
    INSERT INTO performers VALUES ('M1', 'Prefab Sprout'), ('M2', 'Richard Strauss'), ('M3', 'Eugen Jochum'), ('M4', 'Concertgebouworkest');
    INSERT INTO albums VALUES ('JK26706', 'From langley park to memphis', '1 lp', 1, NULL, 1, 2742, NULL, 'https://h/v.jpg', 'https://h/a.jpg'),
                              ('AB00547', 'Don Juan', '2 lp''s', 2, '2019-12', 0, 4886, 'Toelichting', NULL, NULL);
    INSERT INTO album_performers VALUES ('JK26706', 0, 'M1'), ('AB00547', 0, 'M2');
    INSERT INTO labels VALUES ('L1', 'CBS Records', 'CBS'), ('L2', 'Philips', 'Philips');
    INSERT INTO album_releases VALUES ('JK26706', 'L1', '1', NULL, NULL), ('AB00547', 'L2', '2', '028948', NULL);
    INSERT INTO genres VALUES ('T00000000102', 'stijl', 'Pop'), ('HFD000000002', 'hoofdgenre', 'Pop/Rock'), ('T00000000601', 'stijl', 'Symfonisch gedicht');
    INSERT INTO album_genres VALUES ('JK26706', 'T00000000102'), ('JK26706', 'HFD000000002'), ('AB00547', 'T00000000601');
    INSERT INTO works VALUES ('U1', 'Don Juan', 'CLASSICAL');
    INSERT INTO work_composers VALUES ('U1', 'M2');
    INSERT INTO tracks VALUES ('AB00547-0001', 'AB00547', 1, 'Don Juan, op.20', 1075, 'U1');
    INSERT INTO track_performers VALUES ('AB00547-0001', 0, 'M3', NULL, 'dirigent'), ('AB00547-0001', 1, 'M4', NULL, NULL), ('AB00547-0001', 2, NULL, 'Gast', 'viool');
    INSERT INTO collectie_items VALUES ('100000001', 'JK26706', 'Populair'), ('100000002', 'AB00547', 'Klassiek'), ('100000003', NULL, 'Klassiek');
  `)
  if (extra) d.exec(`INSERT INTO collectie_items VALUES ('100000004', 'JK26706', 'Populair'), ('100000005', NULL, 'Populair')`)
  d.close()
  writeFileSync(pad + '.gz', gzipSync(readFileSync(pad)))
}

test('duur: tracks als m:ss, albums als u:mm:ss', () => {
  assert.equal(duurUit(1075), '17:55')
  assert.equal(duurUit(4886), '1:21:26')
  assert.equal(duurUit(2742, true), '0:45:42')
  assert.equal(duurUit(null), null)
  assert.equal(duurUit(0), null)
})

test('lezer: records zoals de oude exports', async () => {
  const pad = join(dir, 'fonotheek.db')
  maakDb(pad)
  const records: any[] = []
  let collectie: any[] = []
  for await (const r of leesFonotheekDb(pad + '.gz', { opCollectie: (c) => { collectie = c } })) records.push(r)
  assert.equal(collectie.length, 3)
  const [klassiek, pop] = records // op code gesorteerd: AB00547, JK26706
  assert.deepEqual(pop, {
    titelnummer: 'JK26706', soort: 'populair', tip: false,
    velden: { titel: 'From langley park to memphis', artiesten: ['Prefab Sprout'], uitgave: 'voor 1988', drager: 'LP', aantal: 1, label: 'CBS Records',
      genres: ['Pop'], speelduur: '0:45:42', tracklist: [], hoes_voor: 'https://h/v.jpg', hoes_achter: 'https://h/a.jpg' },
  })
  assert.equal(klassiek.soort, 'klassiek')
  assert.equal(klassiek.velden.aantal, 2)
  assert.equal(klassiek.velden.ean, '028948')
  assert.equal(klassiek.velden.uitgave, '2019-12')
  assert.equal(klassiek.velden.toelichting, 'Toelichting')
  assert.deepEqual(klassiek.velden.tracklist, [{ pos: 1, titel: 'Don Juan, op.20', duur: '17:55', componisten: ['Richard Strauss'], uitvoerenden: ['Eugen Jochum (dirigent)', 'Concertgebouworkest', 'Gast (viool)'] }])
  assert.deepEqual(klassiek.velden.componisten, ['Richard Strauss'])
  // Een stuk van de albums (voor de stappen in het beheer).
  const stuk: string[] = []
  for await (const r of leesFonotheekDb(pad, { vanaf: 1, aantal: 1 })) stuk.push(r.titelnummer)
  assert.deepEqual(stuk, ['JK26706'])
  // kiesLezer herkent fonotheek.db aan de tabellen.
  const n: any[] = []
  for await (const r of await kiesLezer(pad)) n.push(r)
  assert.equal(n.length, 2)
})

test('vulling: albums en collectie; bij een nieuwe versie alleen nieuwe exemplaren met titelnummer', async () => {
  const pad = join(dir, 'v1', 'fonotheek.db')
  mkdirSync(join(dir, 'v1'))
  maakDb(pad)
  const stil = () => {}
  assert.equal(await laadFonotheek(pad + '.gz', stil), true)
  const ex = await all<any>('SELECT objectnummer, titelnummer, titel_id FROM exemplaren ORDER BY objectnummer')
  assert.deepEqual(ex.map((e) => e.objectnummer), ['100000001', '100000002'])
  assert.ok(ex.every((e) => e.titel_id))
  const t = await get<any>("SELECT soort FROM titels WHERE titelnummer = 'AB00547'")
  assert.equal(t.soort, 'klassiek')
  // Zelfde bestand: niets te doen.
  const imports = (await get<any>("SELECT COUNT(*)::int AS n FROM imports WHERE soort = 'muziekweb'")).n
  await laadFonotheek(pad + '.gz', stil)
  assert.equal((await get<any>("SELECT COUNT(*)::int AS n FROM imports WHERE soort = 'muziekweb'")).n, imports)
  // Nieuwe versie met twee extra regels: alleen die met titelnummer komt erbij.
  const pad2 = join(dir, 'v2', 'fonotheek.db')
  mkdirSync(join(dir, 'v2'))
  maakDb(pad2, true)
  await laadFonotheek(pad2 + '.gz', stil)
  const ex2 = await all<any>('SELECT objectnummer FROM exemplaren ORDER BY objectnummer')
  assert.deepEqual(ex2.map((e) => e.objectnummer), ['100000001', '100000002', '100000004'])
})
