// Tests voor de kernregels uit het functioneel ontwerp. Draaien: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.NODE_ENV = 'test'
process.env.FONOS_OPSLAG_DIR = mkdtempSync(join(tmpdir(), 'fonos-test-opslag-'))
delete process.env.DATABASE_URL

const { useMemoryDb, get, run, zetInstelling } = await import('../server/db.ts')
const { maakTitel, zetFonosWaarde, verwerkMuziekweb, besluitConflict, getoond } = await import('../server/titels.ts')
const { dienAanvraagIn, AanvraagFout, uitgeven, vrijgeven, verwijderItem, sluitAllesAf, kiesSpeler, houdSpelerVast, geefSpelerVrij, geefInactieveSpelersVrij } = await import('../server/aanvragen.ts')
const { leesBestand, analyseer, voerDoor } = await import('../server/importers/collectie.ts')
const { verwerkMuziekwebImport } = await import('../server/importers/muziekweb-verwerk.ts')
const { dragerUit } = await import('../server/importers/muziekweb-lezers.ts')
const { zoek } = await import('../server/zoeken.ts')
const { backupData, leesBackup, vergelijk, zetTerug } = await import('../server/backup.ts')

const IK = { id: null, naam: 'Test' }
await useMemoryDb()

let teller = 500000000
async function titelMetExemplaar(titelnummer: string, titel: string, artiest: string, n = 1) {
  const id = await maakTitel({ titelnummer, mw: { titel, artiesten: [artiest], drager: 'LP', uitgave: '1973' } })
  for (let i = 0; i < n; i++) await run('INSERT INTO exemplaren (objectnummer, titel_id, titelnummer, vindcode) VALUES (?, ?, ?, ?)', String(teller++), id, titelnummer, `A-0${i}`)
  return id
}

test('tweelagenmodel: import overschrijft nooit een Fonos-waarde en meldt een conflict', async () => {
  const id = await maakTitel({ titelnummer: 'AA00001', mw: { titel: 'Dark side', artiesten: ['Pink Floyd'] } })
  await zetFonosWaarde(id, 'titel', 'The Dark Side of the Moon', IK)
  assert.equal(getoond((await get<any>('SELECT * FROM titels WHERE id = ?', id))!).titel, 'The Dark Side of the Moon')
  // Muziekweb verandert een ander veld: geen conflict.
  assert.equal(await verwerkMuziekweb(id, { titel: 'Dark side', artiesten: ['Pink Floyd'], label: 'Harvest' }), 0)
  // Muziekweb verandert het aangepaste veld: conflict, Fonos-waarde blijft getoond.
  assert.equal(await verwerkMuziekweb(id, { titel: 'Dark Side Of The Moon', artiesten: ['Pink Floyd'], label: 'Harvest' }), 1)
  const t = await get<any>('SELECT * FROM titels WHERE id = ?', id)!
  assert.equal(getoond(t).titel, 'The Dark Side of the Moon')
  assert.ok(JSON.parse(t.conflicten).titel)
  await besluitConflict(id, 'titel', 'muziekweb', IK)
  const t2 = await get<any>('SELECT * FROM titels WHERE id = ?', id)!
  assert.equal(getoond(t2).titel, 'Dark Side Of The Moon')
  assert.deepEqual(JSON.parse(t2.conflicten), {})
  assert.equal(t2.heeft_fonos, 0)
})

test('aanvragen: eerst platenspeler kiezen, reserveren, in gebruik, maximum, vrijgeven', async () => {
  const a = await titelMetExemplaar('BB00001', 'Pastel Blues', 'Nina Simone')
  const b = await titelMetExemplaar('BB00002', 'Discovery', 'Daft Punk')
  // Zonder gekozen speler (of met een verkeerde sessie) kan er niets aangevraagd worden.
  await assert.rejects(() => dienAanvraagIn({ platenspeler: 2, titels: [{ titel_id: a }] }), (e: any) => e.code === 'speler_kwijt')
  const s2 = await kiesSpeler(2)
  // Een vastgehouden speler is niet door een ander te kiezen.
  await assert.rejects(() => kiesSpeler(2), (e: any) => e.code === 'bezet')
  const r = await dienAanvraagIn({ platenspeler: 2, sessie: s2, titels: [{ titel_id: a }] })
  assert.ok(r.bestelnummer > 1000)
  // Het enige exemplaar is nu in gebruik.
  const s4 = await kiesSpeler(4)
  await assert.rejects(() => dienAanvraagIn({ platenspeler: 4, sessie: s4, titels: [{ titel_id: a }] }), (e: any) => e instanceof AanvraagFout && e.code === 'niet_beschikbaar')
  // Tweede aanvraag op dezelfde speler: eerst vragen, met bevestiging de vorige afsluiten.
  await assert.rejects(() => dienAanvraagIn({ platenspeler: 2, sessie: s2, titels: [{ titel_id: b }] }), (e: any) => e.code === 'bezet')
  const r2 = await dienAanvraagIn({ platenspeler: 2, sessie: s2, titels: [{ titel_id: b }], bezetAfsluiten: true })
  assert.equal(r2.vorigeAfgesloten, true)
  assert.equal((await get<any>('SELECT status, afgesloten_door FROM aanvragen WHERE id = ?', r.id))!.afgesloten_door, 'bezoeker')
  // Bezoeker geeft de speler vrij: aanvraag afgesloten, speler weer vrij.
  assert.equal(await houdSpelerVast(2, s2), true)
  assert.equal(await geefSpelerVrij(2, 'bezoeker', IK, s2), true)
  assert.equal((await get<any>('SELECT status FROM aanvragen WHERE id = ?', r2.id))!.status, 'afgesloten')
  assert.equal(await houdSpelerVast(2, s2), false)
  // Titel a is weer beschikbaar; de medewerker geeft de speler vrij.
  const s5 = await kiesSpeler(5)
  const r3 = await dienAanvraagIn({ platenspeler: 5, sessie: s5, titels: [{ titel_id: a }] })
  await uitgeven(r3.id, IK)
  await vrijgeven(r3.id, IK)
  assert.equal((await get<any>('SELECT status FROM aanvragen WHERE id = ?', r3.id))!.status, 'afgesloten')
  assert.equal(await houdSpelerVast(5, s5), false)
  // Maximum titels per aanvraag.
  await zetInstelling('max_titels', 1)
  const s6 = await kiesSpeler(6)
  await assert.rejects(() => dienAanvraagIn({ platenspeler: 6, sessie: s6, titels: [{ titel_id: a }, { titel_id: b }] }), (e: any) => e.code === 'te_veel')
  await zetInstelling('max_titels', 3)
  // Inactieve speler is niet te kiezen.
  await run('UPDATE platenspelers SET actief = 0 WHERE nummer = 7')
  await assert.rejects(() => kiesSpeler(7), (e: any) => e.code === 'speler_inactief')
  await run('UPDATE platenspelers SET actief = 1 WHERE nummer = 7')
  // Laatste titel eruit halen = geannuleerd.
  const s7 = await kiesSpeler(7)
  const r4 = await dienAanvraagIn({ platenspeler: 7, sessie: s7, titels: [{ titel_id: a }] })
  const item = await get<any>('SELECT id FROM aanvraag_items WHERE aanvraag_id = ?', r4.id)!
  await verwijderItem(r4.id, item.id, 'niet te vinden', IK)
  assert.equal((await get<any>('SELECT status FROM aanvragen WHERE id = ?', r4.id))!.status, 'geannuleerd')
  // Te lang niet gebruikt: de planner geeft de speler vrij.
  await run("UPDATE platenspelers SET laatst_actief = nu('-30 minutes') WHERE nummer = 7")
  assert.equal(await geefInactieveSpelersVrij(), 1)
  assert.equal(await houdSpelerVast(7, s7), false)
  // Sluitingstijd sluit alles af en geeft alle spelers vrij.
  const s8 = await kiesSpeler(8)
  await dienAanvraagIn({ platenspeler: 8, sessie: s8, titels: [{ titel_id: a }] })
  assert.ok(await sluitAllesAf('sluitingstijd', IK) >= 1)
  assert.equal((await get<any>("SELECT COUNT(*) n FROM aanvragen WHERE status IN ('ingediend', 'uitgegeven')"))!.n, 0)
  assert.equal((await get<any>('SELECT COUNT(*) n FROM platenspelers WHERE sessie IS NOT NULL'))!.n, 0)
})

test('bulkimport: controle-overzicht met categorieën, puntkomma-notatie en dubbelen', async () => {
  await verwerkMuziekwebImport((async function* () {
    yield { titelnummer: 'CC00001', soort: 'populair' as const, tip: false, velden: { titel: 'Rumours', artiesten: ['Fleetwood Mac'], drager: 'LP' } }
  })(), IK, 'test')
  const csv = ['objectnummer,titelnummer,vindcode', '111111111,CC00001,B-01', '222222222,ZZ99999,', ';333333333', '111111111,CC00001,'].join('\n')
  const { regels } = await leesBestand(Buffer.from(csv), 'test.csv')
  const a = await analyseer(regels, 'test.csv')
  assert.equal(a.categorieen.nieuw.length, 1)
  assert.equal(a.categorieen.onbekend.length, 1)
  assert.equal(a.categorieen.zonder_titelnummer.length, 1)
  assert.equal(a.categorieen.dubbel.length, 1)
  // Niets gewijzigd vóór bevestigen.
  assert.equal((await get<any>("SELECT COUNT(*) n FROM exemplaren WHERE objectnummer = '111111111'"))!.n, 0)
  await voerDoor(a.token, ['nieuw', 'onbekend', 'zonder_titelnummer', 'dubbel'], IK)
  const e = await get<any>("SELECT * FROM exemplaren WHERE objectnummer = '111111111'")!
  assert.ok(e.titel_id, 'gekoppeld aan de titel uit de dump')
  assert.equal((await get<any>("SELECT COUNT(*) n FROM import_issues WHERE objectnummer = '111111111'"))!.n, 1)
  assert.equal((await get<any>("SELECT titelnummer FROM exemplaren WHERE objectnummer = '333333333'"))!.titelnummer, null)
})

test('dragers uit het Muziekweb-veld Product', async () => {
  assert.deepEqual(dragerUit('2 compact discs'), { drager: 'CD', aantal: 2 })
  assert.deepEqual(dragerUit("2 lp's"), { drager: 'LP', aantal: 2 })
  assert.deepEqual(dragerUit('1 superaudiocompactdisc'), { drager: 'CD', aantal: 1 })
  assert.equal(dragerUit('1 dvd-video').drager, 'Overig')
})

test('zoeken: accenten, voorvoegsel en kleine typfouten', async () => {
  await titelMetExemplaar('DD00001', 'Symfonie nr. 9 "Uit de nieuwe wereld"', 'Antonín Dvořák')
  const dv = (await get<any>("SELECT id FROM titels WHERE titelnummer = 'DD00001'"))!.id
  assert.equal((await zoek('dvorak'))[0]?.id, dv)
  assert.equal((await zoek('nieuwe wer'))[0]?.id, dv)
  assert.equal((await zoek('dvoark'))[0]?.id, dv) // verwisselde letters
  const floyd = (await get<any>("SELECT id FROM titels WHERE titelnummer = 'BB00002'"))!.id
  assert.equal((await zoek('daft pnuk'))[0]?.id, floyd)
})

test('back-up: terugzetten zet Fonos-waarden terug en vraagt TERUGZETTEN', async () => {
  const id = (await get<any>("SELECT id FROM titels WHERE titelnummer = 'AA00001'"))!.id
  await zetFonosWaarde(id, 'label', 'Eigen label', IK)
  const k = await leesBackup(Buffer.from(JSON.stringify(await backupData())), 'test.json')
  await zetFonosWaarde(id, 'label', 'Later gewijzigd', IK)
  const v = await vergelijk(k)
  assert.equal(v.titels.gewijzigd, 1)
  await assert.rejects(zetTerug(k.token, 'ja', IK, k))
  await zetTerug(k.token, 'TERUGZETTEN', IK, k)
  assert.equal(getoond((await get<any>('SELECT * FROM titels WHERE id = ?', id))!).label, 'Eigen label')
  assert.equal((await get<any>("SELECT COUNT(*) n FROM backups WHERE soort = 'voor_terugzetten'"))!.n, 1)
})
