// Tweede reeks verbeteringen: plaatsvervangers, zoekreden, "Ook luisteren", wachtlijst, vergrendelen, statistieken,
// hoescontrole, dubbele titels en browserfouten.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.NODE_ENV = 'test'
process.env.FONOS_OPSLAG_DIR = mkdtempSync(join(tmpdir(), 'fonos-test-opslag-'))
delete process.env.DATABASE_URL

const { useMemoryDb, get, all, run, zetInstelling, syncPlatenspelers } = await import('../server/db.ts')
const { maakTitel, getoond, echteArtiesten } = await import('../server/titels.ts')
const { zoekreden, ookLuisteren, zoekCatalogus } = await import('../server/catalogus.ts')
const { kiesSpeler, geefSpelerVrij, dienAanvraagIn } = await import('../server/aanvragen.ts')
const { meldAan, wachtStatus, meldAf } = await import('../server/wachtlijst.ts')
const { statistieken } = await import('../server/statistieken.ts')
const { controleerHoezen } = await import('../server/hoezen.ts')
const { maakGebruiker } = await import('../server/auth.ts')
const { app } = await import('../server/app.ts')
await useMemoryDb()

let obj = 700000000
async function titel(titelnummer: string, mw: any) {
  const id = await maakTitel({ titelnummer, mw: { drager: 'LP', uitgave: '1980', ...mw } })
  await run('INSERT INTO exemplaren (objectnummer, titel_id, titelnummer) VALUES (?, ?, ?)', String(obj++), id, titelnummer)
  return id
}

test('plaatsvervangers als "No Artist" verdwijnen uit de getoonde waarden', () => {
  assert.deepEqual(echteArtiesten(['No Artist', 'Herman van Veen', 'Unknown Artist']), ['Herman van Veen'])
  const v = getoond({ mw_data: JSON.stringify({ titel: 'X', artiesten: ['No Artist'], tracklist: [{ pos: 1, titel: 'a', uitvoerenden: ['No Artist', 'Jan (piano)'] }] }), fonos_data: '{}' })
  assert.deepEqual(v.artiesten, [])
  assert.deepEqual(v.tracklist![0].uitvoerenden, ['Jan (piano)'])
})

test('zoekreden: nummer, componist, uitvoerende, label; niets als titel of artiest al past', () => {
  const v = { titel: 'Herman van veen (ii)', artiesten: ['Herman van Veen'], label: 'Philips', componisten: ['Johann Sebastian Bach'],
    uitvoerenden: ['Eugen Jochum (dirigent)'], tracklist: [{ pos: 1, titel: 'Suzanne' }, { pos: 2, titel: 'Cirkels (the windmills of your mind)' }] } as any
  assert.deepEqual(zoekreden(v, 'suzanne'), { soort: 'nummer', tekst: 'Suzanne' })
  assert.deepEqual(zoekreden(v, 'windmills mind'), { soort: 'nummer', tekst: 'Cirkels (the windmills of your mind)' })
  assert.deepEqual(zoekreden(v, 'bach'), { soort: 'componist', tekst: 'Johann Sebastian Bach' })
  assert.deepEqual(zoekreden(v, 'jochum'), { soort: 'met', tekst: 'Eugen Jochum' })
  assert.deepEqual(zoekreden(v, 'philips'), { soort: 'label', tekst: 'Philips' })
  assert.equal(zoekreden(v, 'herman veen'), undefined)
})

test('"Ook luisteren": dezelfde artiest, dan dezelfde stijl; niet de andere uitgave van hetzelfde album', async () => {
  const a = await titel('OL001', { titel: 'Een', artiesten: ['Ann Artiest'], genres: ['Jazz'] })
  const b = await titel('OL002', { titel: 'Twee', artiesten: ['Ann Artiest'], genres: ['Jazz'] })
  await titel('OL003', { titel: 'Een', artiesten: ['Ann Artiest'], genres: ['Jazz'] }) // andere uitgave van "Een"
  const c = await titel('OL004', { titel: 'Drie', artiesten: ['Bob Ander'], genres: ['Jazz'], hoes_voor: 'https://h/x.jpg' })
  const r = await ookLuisteren(a)
  assert.deepEqual(r.artiest.map((k) => k.id), [b])
  assert.equal(r.stijlnaam, 'Jazz')
  assert.ok(r.stijl.some((k) => k.id === c))
  // Samenvoegen: in de zoekresultaten maar één van de twee uitgaven van "Een".
  await zetInstelling('dubbelen_samenvoegen', true)
  const z = await zoekCatalogus({ q: 'Een Ann' })
  assert.equal(z.titels.filter((k) => k.titel === 'Een').length, 1)
  await zetInstelling('dubbelen_samenvoegen', false)
  assert.equal((await zoekCatalogus({ q: 'Een Ann' })).titels.filter((k) => k.titel === 'Een').length, 2)
})

test('wachtlijst: vrijgekomen speler wordt voor de eerste wachtende vastgehouden', async () => {
  await zetInstelling('aantal_platenspelers', 2)
  await syncPlatenspelers(2)
  const s1 = await kiesSpeler(1)
  await kiesSpeler(2)
  const w1 = await meldAan('Tablet A')
  const w2 = await meldAan('Tablet B')
  assert.deepEqual(await wachtStatus(w1.token), { status: 'wacht', positie: 1 })
  assert.deepEqual(await wachtStatus(w2.token), { status: 'wacht', positie: 2 })
  await geefSpelerVrij(1, 'bezoeker', { naam: 'test' }, s1)
  const st = await wachtStatus(w1.token) as any
  assert.equal(st.status, 'opgeroepen')
  assert.equal(st.speler, 1)
  assert.ok(st.seconden > 100 && st.seconden <= 180)
  // Een ander mag speler 1 nu niet kiezen; de wachtende wel.
  await assert.rejects(kiesSpeler(1), /gereserveerd/)
  await assert.rejects(kiesSpeler(1, undefined, w2.token), /gereserveerd/)
  await kiesSpeler(1, undefined, w1.token)
  assert.equal((await wachtStatus(w1.token)).status, 'geholpen')
  // Verlopen reservering: door naar de volgende.
  await geefSpelerVrij(1, 'medewerker', { naam: 'test' })
  assert.equal((await wachtStatus(w2.token) as any).speler, 1)
  await run("UPDATE wachtlijst SET opgeroepen_tot = nu('-1 minute') WHERE token = ?", w2.token)
  await run("UPDATE platenspelers SET gereserveerd_tot = nu('-1 minute') WHERE nummer = 1")
  assert.equal((await wachtStatus(w2.token)).status, 'verlopen')
  await meldAf(w1.token)
  await kiesSpeler(1)
})

test('vergrendelen na inactiviteit: zonder code geen toegang, met code weer verder', async () => {
  await zetInstelling('tweestaps', 'uit')
  await maakGebruiker({ email: 'slot@beeldengeluid.nl', naam: 'Slot', rollen: ['medewerker'], wachtwoord: 'geheim-wachtwoord-2' })
  let cookie = ''
  const vraag = async (pad: string, body?: unknown) => {
    const r = await app.request(pad, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
    const m = /fonos_sessie=([^;]*)/.exec(r.headers.get('set-cookie') ?? '')
    if (m?.[1]) cookie = `fonos_sessie=${m[1]}`
    return { status: r.status, data: await r.json() as any }
  }
  assert.equal((await vraag('/api/auth/login', { email: 'slot@beeldengeluid.nl', wachtwoord: 'geheim-wachtwoord-2' })).status, 200)
  assert.equal((await vraag('/api/medewerker/looplijst')).status, 200)
  await vraag('/api/auth/vergrendel', {})
  assert.equal((await vraag('/api/medewerker/looplijst')).status, 401)
  const ik = await vraag('/api/auth/ik')
  assert.equal(ik.data.vergrendeld.met, 'wachtwoord')
  assert.equal((await vraag('/api/auth/ontgrendel', { wachtwoord: 'fout' })).status, 400)
  assert.equal((await vraag('/api/auth/ontgrendel', { wachtwoord: 'geheim-wachtwoord-2' })).status, 200)
  assert.equal((await vraag('/api/medewerker/looplijst')).status, 200)
  assert.ok(await get("SELECT 1 FROM aanmeldingen WHERE methode = 'ontgrendelen' AND gelukt = 1"))
})

test('statistieken over een periode', async () => {
  const id = await titel('ST001', { titel: 'Populair', artiesten: ['Veel Gevraagd'], genres: ['Pop'] })
  const s = await kiesSpeler(2).catch(async () => { await geefSpelerVrij(2, 'medewerker', { naam: 't' }); return kiesSpeler(2) })
  await dienAanvraagIn({ platenspeler: 2, sessie: s, titels: [{ titel_id: id }] })
  const vandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' })
  const r = await statistieken(vandaag, vandaag)
  assert.ok(r.kern.aanvragen >= 1)
  assert.ok(r.titels.some((t) => t.titel === 'Populair'))
  assert.ok(r.stijlen.some((x) => x.naam === 'Pop'))
  assert.equal(r.drukte.reduce((a, c) => a + c.aantal, 0), r.kern.aanvragen)
})

test('hoescontrole: Muziekweb-vervangplaatje en 404 tellen als kapot, netwerkfout niet', async () => {
  const goed = await titel('HC001', { titel: 'Goed', hoes_voor: 'https://media.cdr.nl/COVER/MEDIUM/FRONT/HC001/a.jpg' })
  const gif = await titel('HC002', { titel: 'Gif', hoes_voor: 'https://media.cdr.nl/COVER/MEDIUM/FRONT/HC002/a.jpg' })
  const weg = await titel('HC003', { titel: 'Weg', hoes_voor: 'https://elders.example/weg.jpg' })
  const stuk = await titel('HC004', { titel: 'Stuk', hoes_voor: 'https://elders.example/time-out.jpg' })
  const echt = globalThis.fetch
  globalThis.fetch = (async (u: string) => {
    if (u.includes('HC001')) return new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    if (u.includes('HC002')) return new Response(null, { status: 200, headers: { 'content-type': 'image/gif' } })
    if (u.includes('weg')) return new Response(null, { status: 404 })
    throw new Error('netwerk')
  }) as any
  try { await controleerHoezen(5000) } finally { globalThis.fetch = echt }
  const k = async (id: number) => (await get<any>('SELECT hoes_kapot, hoes_gecontroleerd_op FROM titels WHERE id = ?', id))
  assert.equal((await k(goed)).hoes_kapot, 0)
  assert.equal((await k(gif)).hoes_kapot, 1)
  assert.equal((await k(weg)).hoes_kapot, 1)
  assert.equal((await k(stuk)).hoes_gecontroleerd_op, null)
  // De kiosk krijgt dan geen hoesadres meer (vervangende afbeelding).
  const z = await zoekCatalogus({ q: 'Gif' })
  assert.equal(z.titels.find((t) => t.id === gif)?.hoes, null)
})

test('browserfouten: opgeslagen, en na 5 keer dezelfde fout een storingsmelding', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await app.request('/api/fout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fonos-Tablet': 'Bar%20links' }, body: JSON.stringify({ bericht: 'TypeError: x is undefined', pagina: '/album/1' }) })
    assert.equal(r.status, 200)
  }
  assert.equal((await all('SELECT * FROM browserfouten WHERE tablet = ?', 'Bar links')).length, 5)
  assert.ok(await get("SELECT 1 FROM wijzigingslog WHERE actie = 'storingsmelding' AND record_id LIKE 'browserfout:%'"))
})
