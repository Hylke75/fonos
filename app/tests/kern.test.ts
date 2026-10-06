// Tests voor de kernregels uit het functioneel ontwerp. Draaien: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.FONOS_BACKUP_DIR = mkdtempSync(join(tmpdir(), 'fonos-test-backup-'))
process.env.FONOS_UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'fonos-test-upload-'))
process.env.FONOS_DB = join(mkdtempSync(join(tmpdir(), 'fonos-test-db-')), 'test.db')

const { useMemoryDb, get, run, zetInstelling } = await import('../server/db.ts')
const { maakTitel, zetFonosWaarde, verwerkMuziekweb, besluitConflict, getoond } = await import('../server/titels.ts')
const { dienAanvraagIn, AanvraagFout, uitgeven, vrijgeven, verwijderItem, sluitAllesAf } = await import('../server/aanvragen.ts')
const { leesBestand, analyseer, voerDoor } = await import('../server/importers/collectie.ts')
const { verwerkMuziekwebImport } = await import('../server/importers/muziekweb-verwerk.ts')
const { dragerUit } = await import('../server/importers/muziekweb-lezers.ts')
const { bouwIndex, zoek } = await import('../server/zoeken.ts')
const { backupData, leesBackup, vergelijk, zetTerug } = await import('../server/backup.ts')

const IK = { id: null, naam: 'Test' }
useMemoryDb()

let teller = 500000000
function titelMetExemplaar(titelnummer: string, titel: string, artiest: string, n = 1) {
  const id = maakTitel({ titelnummer, mw: { titel, artiesten: [artiest], drager: 'LP', uitgave: '1973' } })
  for (let i = 0; i < n; i++) run('INSERT INTO exemplaren (objectnummer, titel_id, titelnummer, vindcode) VALUES (?, ?, ?, ?)', String(teller++), id, titelnummer, `A-0${i}`)
  return id
}

test('tweelagenmodel: import overschrijft nooit een Fonos-waarde en meldt een conflict', () => {
  const id = maakTitel({ titelnummer: 'AA00001', mw: { titel: 'Dark side', artiesten: ['Pink Floyd'] } })
  zetFonosWaarde(id, 'titel', 'The Dark Side of the Moon', IK)
  assert.equal(getoond(get<any>('SELECT * FROM titels WHERE id = ?', id)!).titel, 'The Dark Side of the Moon')
  // Muziekweb verandert een ander veld: geen conflict.
  assert.equal(verwerkMuziekweb(id, { titel: 'Dark side', artiesten: ['Pink Floyd'], label: 'Harvest' }), 0)
  // Muziekweb verandert het aangepaste veld: conflict, Fonos-waarde blijft getoond.
  assert.equal(verwerkMuziekweb(id, { titel: 'Dark Side Of The Moon', artiesten: ['Pink Floyd'], label: 'Harvest' }), 1)
  const t = get<any>('SELECT * FROM titels WHERE id = ?', id)!
  assert.equal(getoond(t).titel, 'The Dark Side of the Moon')
  assert.ok(JSON.parse(t.conflicten).titel)
  besluitConflict(id, 'titel', 'muziekweb', IK)
  const t2 = get<any>('SELECT * FROM titels WHERE id = ?', id)!
  assert.equal(getoond(t2).titel, 'Dark Side Of The Moon')
  assert.deepEqual(JSON.parse(t2.conflicten), {})
  assert.equal(t2.heeft_fonos, 0)
})

test('aanvragen: reserveren, bezette speler, in gebruik, maximum', () => {
  const a = titelMetExemplaar('BB00001', 'Pastel Blues', 'Nina Simone')
  const b = titelMetExemplaar('BB00002', 'Discovery', 'Daft Punk')
  const r = dienAanvraagIn({ platenspeler: 2, titels: [{ titel_id: a }] })
  assert.ok(r.bestelnummer > 1000)
  // Het enige exemplaar is nu in gebruik.
  assert.throws(() => dienAanvraagIn({ platenspeler: 4, titels: [{ titel_id: a }] }), (e: any) => e instanceof AanvraagFout && e.code === 'niet_beschikbaar')
  // Bezette speler: eerst vragen, met bevestiging de vorige afsluiten.
  assert.throws(() => dienAanvraagIn({ platenspeler: 2, titels: [{ titel_id: b }] }), (e: any) => e.code === 'bezet')
  const r2 = dienAanvraagIn({ platenspeler: 2, titels: [{ titel_id: b }], bezetAfsluiten: true })
  assert.equal(r2.vorigeAfgesloten, true)
  assert.equal(get<any>('SELECT status, afgesloten_door FROM aanvragen WHERE id = ?', r.id)!.afgesloten_door, 'bezoeker')
  // Titel a is weer beschikbaar.
  const r3 = dienAanvraagIn({ platenspeler: 5, titels: [{ titel_id: a }] })
  uitgeven(r3.id, IK)
  vrijgeven(r3.id, IK)
  assert.equal(get<any>('SELECT status FROM aanvragen WHERE id = ?', r3.id)!.status, 'afgesloten')
  // Maximum titels per aanvraag.
  zetInstelling('max_titels', 1)
  assert.throws(() => dienAanvraagIn({ platenspeler: 6, titels: [{ titel_id: a }, { titel_id: b }] }), (e: any) => e.code === 'te_veel')
  zetInstelling('max_titels', 3)
  // Inactieve speler is niet te kiezen.
  run('UPDATE platenspelers SET actief = 0 WHERE nummer = 7')
  assert.throws(() => dienAanvraagIn({ platenspeler: 7, titels: [{ titel_id: a }] }), (e: any) => e.code === 'speler_inactief')
  run('UPDATE platenspelers SET actief = 1 WHERE nummer = 7')
  // Laatste titel eruit halen = geannuleerd.
  const r4 = dienAanvraagIn({ platenspeler: 7, titels: [{ titel_id: a }] })
  const item = get<any>('SELECT id FROM aanvraag_items WHERE aanvraag_id = ?', r4.id)!
  verwijderItem(r4.id, item.id, 'niet te vinden', IK)
  assert.equal(get<any>('SELECT status FROM aanvragen WHERE id = ?', r4.id)!.status, 'geannuleerd')
  // Sluitingstijd sluit alles af.
  assert.ok(sluitAllesAf('sluitingstijd', IK) >= 1)
  assert.equal(get<any>("SELECT COUNT(*) n FROM aanvragen WHERE status IN ('ingediend', 'uitgegeven')")!.n, 0)
})

test('bulkimport: controle-overzicht met categorieën, puntkomma-notatie en dubbelen', async () => {
  await verwerkMuziekwebImport((async function* () {
    yield { titelnummer: 'CC00001', soort: 'populair' as const, tip: false, velden: { titel: 'Rumours', artiesten: ['Fleetwood Mac'], drager: 'LP' } }
  })(), IK, 'test')
  const csv = ['objectnummer,titelnummer,vindcode', '111111111,CC00001,B-01', '222222222,ZZ99999,', ';333333333', '111111111,CC00001,'].join('\n')
  const { regels } = await leesBestand(Buffer.from(csv), 'test.csv')
  const a = analyseer(regels, 'test.csv')
  assert.equal(a.categorieen.nieuw.length, 1)
  assert.equal(a.categorieen.onbekend.length, 1)
  assert.equal(a.categorieen.zonder_titelnummer.length, 1)
  assert.equal(a.categorieen.dubbel.length, 1)
  // Niets gewijzigd vóór bevestigen.
  assert.equal(get<any>("SELECT COUNT(*) n FROM exemplaren WHERE objectnummer = '111111111'")!.n, 0)
  voerDoor(a.token, ['nieuw', 'onbekend', 'zonder_titelnummer', 'dubbel'], IK)
  const e = get<any>("SELECT * FROM exemplaren WHERE objectnummer = '111111111'")!
  assert.ok(e.titel_id, 'gekoppeld aan de titel uit de dump')
  assert.equal(get<any>("SELECT COUNT(*) n FROM import_issues WHERE objectnummer = '111111111'")!.n, 1)
  assert.equal(get<any>("SELECT titelnummer FROM exemplaren WHERE objectnummer = '333333333'")!.titelnummer, null)
})

test('dragers uit het Muziekweb-veld Product', () => {
  assert.deepEqual(dragerUit('2 compact discs'), { drager: 'CD', aantal: 2 })
  assert.deepEqual(dragerUit("2 lp's"), { drager: 'LP', aantal: 2 })
  assert.deepEqual(dragerUit('1 superaudiocompactdisc'), { drager: 'CD', aantal: 1 })
  assert.equal(dragerUit('1 dvd-video').drager, 'Overig')
})

test('zoeken: accenten, voorvoegsel en kleine typfouten', () => {
  titelMetExemplaar('DD00001', 'Symfonie nr. 9 "Uit de nieuwe wereld"', 'Antonín Dvořák')
  bouwIndex()
  const dv = get<any>("SELECT id FROM titels WHERE titelnummer = 'DD00001'")!.id
  assert.equal(zoek('dvorak')[0]?.id, dv)
  assert.equal(zoek('nieuwe wer')[0]?.id, dv)
  assert.equal(zoek('dvoark')[0]?.id, dv) // verwisselde letters
  const floyd = get<any>("SELECT id FROM titels WHERE titelnummer = 'BB00002'")!.id
  assert.equal(zoek('daft pnuk')[0]?.id, floyd)
})

test('back-up: terugzetten zet Fonos-waarden terug en vraagt TERUGZETTEN', async () => {
  const id = get<any>("SELECT id FROM titels WHERE titelnummer = 'AA00001'")!.id
  zetFonosWaarde(id, 'label', 'Eigen label', IK)
  const k = await leesBackup(Buffer.from(JSON.stringify(backupData())), 'test.json')
  zetFonosWaarde(id, 'label', 'Later gewijzigd', IK)
  const v = vergelijk(k)
  assert.equal(v.titels.gewijzigd, 1)
  await assert.rejects(zetTerug(k.token, 'ja', IK))
  await zetTerug(k.token, 'TERUGZETTEN', IK)
  assert.equal(getoond(get<any>('SELECT * FROM titels WHERE id = ?', id)!).label, 'Eigen label')
  assert.equal(get<any>("SELECT COUNT(*) n FROM backups WHERE soort = 'voor_terugzetten'")!.n, 1)
})
