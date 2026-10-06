// Back-up en herstel (12). Alleen voor de rol beheerder.
// Bestanden staan in de aparte opslag (Vercel Blob of lokale map), niet in de database.
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { all, get, insert, instellingen, json, run, tx } from './db.ts'
import { log, SYSTEEM, type Wie } from './log.ts'
import { sluitAllesAf } from './aanvragen.ts'
import { getoond } from './titels.ts'
import { aanvragenGewijzigd, beschikbaarheidGewijzigd, catalogusVersieOmhoog } from './events.ts'
import { stuurMail } from './mail.ts'
import { ruimUploadsOp, zetTerugOpAdres, bewaar, isEigenUpload, lees, lokaalPad, verwijder } from './opslag.ts'

// Tabellen in de back-up. Niet: gebruikers en wachtwoorden, sessies, de Muziekweb-dump (opnieuw te importeren).
const TABELLEN = [
  'titels', 'exemplaren', 'import_issues', 'platenspelers', 'genreknoppen', 'genre_koppelingen',
  'selecties', 'selectie_titels', 'instellingen', 'aanvragen', 'aanvraag_items', 'wijzigingslog', 'imports',
] as const
export const VERSIE = 2

export async function backupData() {
  const tabellen: Record<string, any[]> = {}
  for (const t of TABELLEN) {
    tabellen[t] = t === 'titels'
      ? await all('SELECT *, zoek::text AS zoek FROM titels ORDER BY id')
      : await all(`SELECT * FROM ${t}`)
  }
  return { formaat: 'fonotheek-backup', versie: VERSIE, gemaakt: new Date().toISOString(), tabellen }
}

/** Door Fonos geüploade hoezen en genreknop-afbeeldingen (Muziekweb-hoezen niet). */
function eigenUploads(data: Awaited<ReturnType<typeof backupData>>): string[] {
  const s = new Set<string>()
  for (const t of data.tabellen.titels) {
    const f = json<any>(t.fonos_data, {})
    for (const k of ['hoes_voor', 'hoes_achter']) if (isEigenUpload(f[k])) s.add(f[k])
  }
  for (const k of data.tabellen.genreknoppen) if (isEigenUpload(k.afbeelding)) s.add(k.afbeelding)
  return [...s]
}

async function excel(data: Awaited<ReturnType<typeof backupData>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const blad = (naam: string, kolommen: string[], rijen: any[][]) => {
    const ws = wb.addWorksheet(naam)
    ws.addRow(kolommen).font = { bold: true }
    for (const r of rijen) ws.addRow(r)
  }
  const t = data.tabellen
  blad('Titels', ['ID', 'Titelnummer', 'Soort', 'Titel', 'Artiest(en)', 'Jaar', 'Drager', 'Label', 'Genres', 'Zichtbaar', 'Uitgelicht', 'Aangepast door Fonos (velden)', 'Fonos-verhaal', 'AI-tekst'],
    t.titels.map((r) => {
      const v = getoond(r)
      return [r.id, r.titelnummer, r.soort, v.titel, (v.artiesten ?? []).join(', '), r.d_jaar, v.drager, v.label, (v.genres ?? []).join(', '),
        r.zichtbaar ? 'ja' : 'nee', r.uitgelicht ? 'ja' : 'nee', Object.keys(json(r.fonos_data, {})).join(', '), r.fonos_verhaal, r.ai_tekst ? 'ja' : 'nee']
    }))
  blad('Exemplaren', ['ID', 'Objectnummer', 'Titel-ID', 'Titelnummer', 'Vindcode', 'Status', 'Reden afvoer', 'Toelichting'],
    t.exemplaren.map((e) => [e.id, e.objectnummer, e.titel_id, e.titelnummer, e.vindcode, e.status, e.reden_afvoer, e.toelichting_afvoer]))
  blad('Genreknoppen', ['ID', 'Naam', 'Volgorde', 'Actief', 'Kleur', 'Nederlands'], t.genreknoppen.map((k) => [k.id, k.naam, k.volgorde, k.actief, k.kleur, k.nederlands]))
  blad('Genrekoppelingen', ['Knop-ID', 'Muziekweb-genre', 'Weergavenaam'], t.genre_koppelingen.map((k) => [k.knop_id, k.mw_genre, k.weergavenaam]))
  blad('Selecties', ['ID', 'Naam', 'Soort', 'Volgorde', 'Actief', 'Begin', 'Eind'], t.selecties.map((s) => [s.id, s.naam, s.soort, s.volgorde, s.actief, s.begin, s.eind]))
  blad('Instellingen', ['Sleutel', 'Waarde'], t.instellingen.map((s) => [s.sleutel, s.waarde]))
  blad('Platenspelers', ['Nummer', 'Actief'], t.platenspelers.map((p) => [p.nummer, p.actief]))
  blad('Wijzigingslog', ['Tijd', 'Gebruiker', 'Actie', 'Record', 'Veld', 'Oud', 'Nieuw'],
    t.wijzigingslog.slice(-100000).map((l) => [l.tijd, l.gebruiker, l.actie, `${l.record_type ?? ''} ${l.record_label ?? l.record_id ?? ''}`.trim(), l.veld, l.oud?.slice(0, 2000), l.nieuw?.slice(0, 2000)]))
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** Bouwt een zip: JSON (om terug te zetten), optioneel Excel (leesbaar) en de geüploade hoezen. */
export async function maakZip(opts: { excel: boolean; hoezen: boolean }): Promise<Buffer> {
  const data = await backupData()
  const zip = new JSZip()
  zip.file('fonotheek-backup.json', JSON.stringify(data))
  if (opts.excel) zip.file('fonotheek-backup.xlsx', await excel(data))
  if (opts.hoezen) {
    const lijst: Record<string, string> = {}
    for (const adres of eigenUploads(data)) {
      try {
        const naam = basename(new URL(adres, 'http://x').pathname)
        zip.file(`hoezen/${naam}`, await lees(adres))
        lijst[naam] = adres
      } catch { /* bestand niet meer aanwezig */ }
    }
    zip.file('hoezen/index.json', JSON.stringify(lijst))
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

const stempel = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

/** Back-up in de aparte opslag (dagelijks, handmatig of vlak voor terugzetten). */
export async function maakBackup(soort: 'dagelijks' | 'handmatig' | 'voor_terugzetten', wie: Wie = SYSTEEM) {
  const naam = `fonotheek-${soort}-${stempel()}.zip`
  try {
    const buf = await maakZip({ excel: soort === 'handmatig', hoezen: true })
    const adres = await bewaar('backups', naam, buf, 'application/zip')
    const id = await insert("INSERT INTO backups (soort, bestand, omvang, status) VALUES (?, ?, ?, 'gelukt')", soort, adres, buf.length)
    if (soort === 'dagelijks') await ruimOp()
    return { id, bestand: naam, adres, omvang: buf.length }
  } catch (e: any) {
    await run("INSERT INTO backups (soort, bestand, status, fout) VALUES (?, ?, 'mislukt', ?)", soort, naam, String(e?.message ?? e))
    await log(wie, 'back-up mislukt', { type: 'backup', nieuw: String(e?.message ?? e) })
    const beheerders = (await all<any>("SELECT email FROM gebruikers WHERE actief = 1 AND rollen LIKE '%beheerder%'")).map((g) => g.email)
    if (beheerders.length) await stuurMail(beheerders, 'Back-up Fonotheek mislukt', `De back-up (${soort}) van ${new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })} is mislukt:\n\n${e?.message ?? e}`).catch(() => {})
    throw e
  }
}

/** Bewaartermijn: N dagelijkse back-ups plus één per maand voor M maanden (open punt O-8). */
export async function ruimOp() {
  const inst = await instellingen()
  const dagelijks = await all<any>("SELECT * FROM backups WHERE soort = 'dagelijks' AND status = 'gelukt' ORDER BY tijd DESC")
  const houd = new Set<number>(dagelijks.slice(0, inst.backup_bewaar_dagelijks).map((b) => b.id))
  const maanden = new Map<string, any>()
  for (const b of dagelijks) maanden.set(b.tijd.slice(0, 7), b) // oudste van elke maand blijft over
  for (const b of [...maanden.values()].sort((a, b) => b.tijd.localeCompare(a.tijd)).slice(0, inst.backup_bewaar_maandelijks)) houd.add(b.id)
  for (const b of dagelijks) if (!houd.has(b.id)) {
    await verwijder(b.bestand)
    await run('DELETE FROM backups WHERE id = ?', b.id)
  }
  // Handmatige back-ups en back-ups vóór terugzetten: na de ingestelde termijn (O-8).
  const dagen = Number(inst.backup_bewaar_handmatig_dagen) || 90
  for (const b of await all<any>("SELECT * FROM backups WHERE soort IN ('handmatig', 'voor_terugzetten') AND tijd < nu(?::interval)", `-${dagen} days`)) {
    await verwijder(b.bestand)
    await run('DELETE FROM backups WHERE id = ?', b.id)
  }
  // Downloadbestanden en geüploade importbestanden (map uploads) zijn tijdelijk: na een dag weg.
  await ruimUploadsOp(24 * 3600 * 1000).catch((e) => console.error('[backup] opruimen uploads mislukt', e))
}

export async function backupAdres(id: number) {
  const b = await get<any>("SELECT * FROM backups WHERE id = ? AND status = 'gelukt'", id)
  return b ? { adres: b.bestand as string, naam: basename(new URL(b.bestand, 'http://x').pathname) } : null
}

// ------------------------------------------------------------------ terugzetten (12.4)

type Kandidaat = { token: string; data: Awaited<ReturnType<typeof backupData>>; hoezen: Record<string, Buffer>; index: Record<string, string>; bron: string }

/** Leest een back-up (zip of JSON). Het adres wordt bewaard zodat terugzetten in een volgend verzoek kan. */
export async function leesBackup(adresOfBuffer: string | Buffer, bron: string, token: string = randomUUID()): Promise<Kandidaat> {
  const buf = typeof adresOfBuffer === 'string' ? await lees(adresOfBuffer) : adresOfBuffer
  let data: any
  const hoezen: Record<string, Buffer> = {}
  let index: Record<string, string> = {}
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buf)
    const j = zip.file('fonotheek-backup.json')
    if (!j) throw new Error('Geen fonotheek-backup.json in dit zip-bestand')
    data = JSON.parse(await j.async('string'))
    const ix = zip.file('hoezen/index.json')
    if (ix) index = JSON.parse(await ix.async('string'))
    for (const f of Object.values(zip.files)) if (f.name.startsWith('hoezen/') && !f.dir && !f.name.endsWith('index.json')) hoezen[basename(f.name)] = await f.async('nodebuffer')
  } else data = JSON.parse(buf.toString('utf8'))
  if (data?.formaat !== 'fonotheek-backup' || !data.tabellen) throw new Error('Dit is geen back-up van de Fonotheek')
  if (typeof adresOfBuffer === 'string') {
    await run("DELETE FROM taken WHERE soort = 'terugzetten' AND tijd < nu('-2 hours')")
    await run("INSERT INTO taken (id, soort, data) VALUES (?, 'terugzetten', ?) ON CONFLICT (id) DO NOTHING", token, JSON.stringify({ adres: adresOfBuffer, bron }))
  }
  return { token, data, hoezen, index, bron }
}

/** Controle-overzicht: wat wordt er toegevoegd, gewijzigd of verwijderd. */
export async function vergelijk(k: Kandidaat) {
  const telling = async (tabel: string, sleutel: string, vergelijkVelden?: string[]) => {
    const huidig = new Map((await all<any>(`SELECT * FROM ${tabel}`)).map((r) => [String(r[sleutel]), r]))
    const nieuw = new Map((k.data.tabellen[tabel] ?? []).map((r: any) => [String(r[sleutel]), r]))
    let toegevoegd = 0, gewijzigd = 0, verwijderd = 0
    for (const [key, r] of nieuw) {
      const h = huidig.get(key)
      if (!h) toegevoegd++
      else if ((vergelijkVelden ?? Object.keys(r)).some((f) => String(h[f] ?? '') !== String((r as any)[f] ?? ''))) gewijzigd++
    }
    for (const key of huidig.keys()) if (!nieuw.has(key)) verwijderd++
    return { toegevoegd, gewijzigd, verwijderd, totaal: nieuw.size }
  }
  const fonosAanpassingen = (rijen: any[]) => rijen.reduce((n, r) => n + Object.keys(json(r.fonos_data, {})).length, 0)
  return {
    token: k.token,
    bron: k.bron,
    gemaakt: k.data.gemaakt,
    titels: await telling('titels', 'id', ['titelnummer', 'fonos_data', 'zichtbaar', 'uitgelicht', 'fonos_verhaal', 'ai_tekst']),
    exemplaren: await telling('exemplaren', 'id', ['objectnummer', 'titel_id', 'titelnummer', 'vindcode', 'status', 'reden_afvoer']),
    fonos_aanpassingen: { huidig: fonosAanpassingen(await all('SELECT fonos_data FROM titels')), backup: fonosAanpassingen(k.data.tabellen.titels ?? []) },
    configuratie: {
      genreknoppen: await telling('genreknoppen', 'id'),
      genre_koppelingen: await telling('genre_koppelingen', 'id'),
      selecties: await telling('selecties', 'id'),
      instellingen: await telling('instellingen', 'sleutel'),
      platenspelers: await telling('platenspelers', 'nummer'),
    },
    open_aanvragen: (await get<{ n: number }>("SELECT COUNT(*) AS n FROM aanvragen WHERE status IN ('ingediend', 'uitgegeven')"))!.n,
    hoezen: Object.keys(k.hoezen).length,
  }
}

async function vul(tabel: string, rijen: any[]) {
  for (let i = 0; i < rijen.length; i += 2000) {
    await run(`INSERT INTO ${tabel} SELECT * FROM jsonb_populate_recordset(null::${tabel}, ?::jsonb)`, JSON.stringify(rijen.slice(i, i + 2000)))
  }
}

export async function zetTerug(token: string, bevestiging: string, wie: Wie, kandidaat?: Kandidaat) {
  if (bevestiging !== 'TERUGZETTEN') throw new Error('Typ TERUGZETTEN om te bevestigen')
  let k = kandidaat
  if (!k) {
    const t = await get<{ data: string }>("SELECT data FROM taken WHERE id = ? AND soort = 'terugzetten'", token)
    if (!t) throw new Error('Het controle-overzicht is verlopen. Kies de back-up opnieuw.')
    const { adres, bron } = JSON.parse(t.data)
    k = await leesBackup(adres, bron, token)
  }
  // Vlak voor het terugzetten: automatisch een back-up van de huidige stand.
  const voor = await maakBackup('voor_terugzetten', wie)
  await sluitAllesAf('terugzetten', wie)
  await tx(async () => {
    for (const t of [...TABELLEN].reverse()) if (t !== 'wijzigingslog') await run(`DELETE FROM ${t}`)
    for (const t of TABELLEN) if (t !== 'wijzigingslog') await vul(t, k!.data.tabellen[t] ?? [])
    // Het log loopt door; de geschiedenis uit de back-up wordt aangevuld.
    const bekend = new Set((await all<{ id: number }>('SELECT id FROM wijzigingslog')).map((r) => r.id))
    await vul('wijzigingslog', (k!.data.tabellen.wijzigingslog ?? []).filter((r: any) => !bekend.has(r.id)))
    // Open aanvragen uit de back-up zijn niet meer actueel.
    await run("UPDATE aanvragen SET status = 'afgesloten', afgesloten_op = nu(), afgesloten_door = 'terugzetten' WHERE status IN ('ingediend', 'uitgegeven')")
    for (const t of ['titels', 'exemplaren', 'import_issues', 'aanvragen', 'aanvraag_items', 'genreknoppen', 'genre_koppelingen', 'selecties', 'wijzigingslog', 'imports']) {
      await run(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${t}), 0), 1))`)
    }
  })
  // Ontbrekende eigen hoezen terugschrijven op hetzelfde adres (lokale opslag en Vercel Blob, 12.4).
  for (const [naam, adres] of Object.entries(k.index)) {
    if (!k.hoezen[naam]) continue
    if (adres.startsWith('/uploads/')) {
      const p = lokaalPad(adres)
      if (!existsSync(p)) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, k.hoezen[naam]) }
    } else await zetTerugOpAdres(adres, k.hoezen[naam]).catch((e) => console.error('[backup] hoes niet teruggezet', adres, e))
  }
  await run('DELETE FROM taken WHERE id = ?', token)
  await log(wie, 'back-up teruggezet', { type: 'backup', label: k.bron, nieuw: { gemaakt: k.data.gemaakt, back_up_vooraf: voor.bestand } })
  await catalogusVersieOmhoog()
  await aanvragenGewijzigd()
  await beschikbaarheidGewijzigd()
  return { back_up_vooraf: voor.bestand }
}
