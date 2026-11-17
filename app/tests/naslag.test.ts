// Muziekweb-naslag in de kiosk: cd's zijn aan te vragen, lp's alleen te bekijken; de eigen collectie gaat voor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.NODE_ENV = 'test'
process.env.FONOS_OPSLAG_DIR = mkdtempSync(join(tmpdir(), 'fonos-test-opslag-'))
delete process.env.DATABASE_URL

const { useMemoryDb, run, get, all } = await import('../server/db.ts')
const { maakNaslagTitels, maakTitelsBulk } = await import('../server/importers/muziekweb-verwerk.ts')
const { zoekCatalogus, album, beschikbaarheid } = await import('../server/catalogus.ts')
const { analyseer } = await import('../server/importers/collectie.ts')
await useMemoryDb()

const rec = (titelnummer: string, titel: string, drager: string) => ({ titelnummer, soort: 'populair', tip: false, velden: { titel, artiesten: ['Zeta Band'], drager } }) as any

test('naslag: cd aan te vragen, lp alleen te bekijken, eigen collectie eerst', async () => {
  // Eigen collectie: één lp met een exemplaar.
  const eigen = await maakTitelsBulk([{ titelnummer: 'FON001', soort: 'populair', tip: false, mw: { titel: 'Eigen plaat', artiesten: ['Zeta Band'], drager: 'LP' } as any }])
  await run("INSERT INTO exemplaren (objectnummer, titel_id, titelnummer, vindcode, bron) VALUES ('OBJ1', ?, 'FON001', 'A1', 'collectie')", eigen.get('FON001'))

  assert.equal(await maakNaslagTitels([rec('MWCD01', 'Naslag cd', 'CD'), rec('MWLP01', 'Naslag lp', 'LP'), rec('FON001', 'Eigen plaat', 'LP')]), 2)
  // Nog een keer: niets dubbel.
  assert.equal(await maakNaslagTitels([rec('MWCD01', 'Naslag cd', 'CD')]), 0)
  const ex = await all<any>("SELECT objectnummer, bron FROM exemplaren WHERE bron = 'muziekweb'")
  assert.deepEqual(ex, [{ objectnummer: 'MW-MWCD01', bron: 'muziekweb' }])

  const r = await zoekCatalogus({})
  assert.equal(r.totaal, 3)
  assert.equal(r.titels[0].titel, 'Eigen plaat') // eigen collectie eerst
  const cd = r.titels.find((k) => k.titel === 'Naslag cd')!
  const lp = r.titels.find((k) => k.titel === 'Naslag lp')!
  assert.equal(cd.collectie, 'muziekweb'); assert.equal(cd.beschikbaar, true)
  assert.equal(lp.collectie, 'muziekweb'); assert.equal(lp.beschikbaar, false)

  const a = await album(lp.id)
  assert.ok(a); assert.equal(a!.collectie, 'muziekweb'); assert.equal(a!.exemplaren.length, 0)
  const b = await beschikbaarheid([cd.id, lp.id])
  assert.equal(b[cd.id].beschikbaar, true); assert.equal(b[cd.id].vindcode, 'MWCD01')
  assert.equal(b[lp.id].beschikbaar, false)

  // Een bulkimport van de gebruikscollectie ziet de Muziekweb-exemplaren niet als "ontbrekend".
  const an = await analyseer([{ objectnummer: 'OBJ1', titelnummer: 'FON001', vindcode: 'A1', bron: 'test', regel: 1 }], 'test.xlsx')
  assert.equal(an.categorieen.ontbrekend.length, 0)
  assert.equal((await get<any>("SELECT status FROM exemplaren WHERE objectnummer = 'MW-MWCD01'")).status, 'in_collectie')
})
