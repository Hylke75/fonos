// Back-up en herstel (12). Alleen voor de rol beheerder.
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { createWriteStream, existsSync, readdirSync, readFileSync, statSync, unlinkSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { all, db, get, instellingen, json, run, BACKUP_DIR, UPLOAD_DIR } from './db.ts'
import { log, SYSTEEM, type Wie } from './log.ts'
import { sluitAllesAf } from './aanvragen.ts'
import { getoond } from './titels.ts'
import { markeerVuil } from './zoeken.ts'
import { aanvragenGewijzigd, beschikbaarheidGewijzigd } from './events.ts'
import { stuurMail } from './mail.ts'

// Tabellen in de back-up. Niet: gebruikers en wachtwoorden, sessies, de Muziekweb-dump (opnieuw te importeren).
const TABELLEN = [
  'titels', 'exemplaren', 'import_issues', 'platenspelers', 'genreknoppen', 'genre_koppelingen',
  'selecties', 'selectie_titels', 'instellingen', 'aanvragen', 'aanvraag_items', 'wijzigingslog', 'imports',
] as const
export const VERSIE = 1

export function backupData() {
  const tabellen: Record<string, any[]> = {}
  for (const t of TABELLEN) tabellen[t] = all(`SELECT * FROM ${t}`)
  return { formaat: 'fonotheek-backup', versie: VERSIE, gemaakt: new Date().toISOString(), tabellen }
}

/** Door Fonos geüploade hoezen (en genreknop-afbeeldingen). Muziekweb-hoezen zitten er niet in. */
function uploads(): string[] {
  if (!existsSync(UPLOAD_DIR)) return []
  return readdirSync(UPLOAD_DIR).filter((f) => statSync(join(UPLOAD_DIR, f)).isFile())
}

async function excel(data: ReturnType<typeof backupData>): Promise<Buffer> {
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

/** Bouwt de zip in een worker-thread (zie backup-worker.ts) en geeft de omvang terug. */
export function maakZip(opts: { excel: boolean; hoezen: boolean }, doel: string): Promise<number> {
  return new Promise((res, rej) => {
    const w = new Worker(new URL('./backup-worker.ts', import.meta.url), { workerData: { opts, doel }, execArgv: ['--import', 'tsx'] })
    w.once('message', (m: any) => (m.fout ? rej(new Error(m.fout)) : res(m.omvang)))
    w.once('error', rej)
  })
}

/** Bouwt een zip: JSON (om terug te zetten), optioneel Excel (leesbaar) en de geüploade hoezen. */
export async function maakZipDirect(opts: { excel: boolean; hoezen: boolean }, doel: string) {
  const data = backupData()
  const zip = new JSZip()
  zip.file('fonotheek-backup.json', JSON.stringify(data))
  if (opts.excel) zip.file('fonotheek-backup.xlsx', await excel(data))
  if (opts.hoezen) for (const f of uploads()) zip.file(`hoezen/${f}`, readFileSync(join(UPLOAD_DIR, f)))
  await new Promise<void>((res, rej) => {
    zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } })
      .pipe(createWriteStream(doel)).on('finish', () => res()).on('error', rej)
  })
  return statSync(doel).size
}

const stempel = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

/** Back-up in de back-upmap (dagelijks of vlak voor terugzetten). */
export async function maakBackup(soort: 'dagelijks' | 'handmatig' | 'voor_terugzetten', wie: Wie = SYSTEEM) {
  mkdirSync(BACKUP_DIR, { recursive: true })
  const bestand = `fonotheek-${soort}-${stempel()}.zip`
  try {
    const omvang = await maakZip({ excel: soort === 'handmatig', hoezen: true }, join(BACKUP_DIR, bestand))
    const id = Number(run("INSERT INTO backups (soort, bestand, omvang, status) VALUES (?, ?, ?, 'gelukt')", soort, bestand, omvang).lastInsertRowid)
    if (soort === 'dagelijks') ruimOp()
    return { id, bestand, omvang }
  } catch (e: any) {
    run("INSERT INTO backups (soort, bestand, status, fout) VALUES (?, ?, 'mislukt', ?)", soort, bestand, String(e?.message ?? e))
    log(wie, 'back-up mislukt', { type: 'backup', nieuw: String(e?.message ?? e) })
    const beheerders = all<any>("SELECT email FROM gebruikers WHERE actief = 1 AND rollen LIKE '%beheerder%'").map((g) => g.email)
    if (beheerders.length) stuurMail(beheerders, 'Back-up Fonotheek mislukt', `De ${soort}e back-up van ${new Date().toLocaleString('nl-NL')} is mislukt:\n\n${e?.message ?? e}`).catch(() => {})
    throw e
  }
}

/** Bewaartermijn: N dagelijkse back-ups plus één per maand voor M maanden (open punt O-8). */
export function ruimOp() {
  const inst = instellingen()
  const dagelijks = all<any>("SELECT * FROM backups WHERE soort = 'dagelijks' AND status = 'gelukt' ORDER BY tijd DESC")
  const houd = new Set<number>(dagelijks.slice(0, inst.backup_bewaar_dagelijks).map((b) => b.id))
  const maanden = new Map<string, any>()
  for (const b of dagelijks) { const m = b.tijd.slice(0, 7); maanden.set(m, b) } // oudste van elke maand blijft over
  for (const b of [...maanden.values()].sort((a, b) => b.tijd.localeCompare(a.tijd)).slice(0, inst.backup_bewaar_maandelijks)) houd.add(b.id)
  for (const b of dagelijks) if (!houd.has(b.id)) {
    const p = join(BACKUP_DIR, b.bestand)
    if (existsSync(p)) unlinkSync(p)
    run('DELETE FROM backups WHERE id = ?', b.id)
  }
}

export function backupPad(id: number) {
  const b = get<any>("SELECT * FROM backups WHERE id = ? AND status = 'gelukt'", id)
  if (!b) return null
  const p = join(BACKUP_DIR, basename(b.bestand))
  return existsSync(p) ? { pad: p, bestand: b.bestand } : null
}

// ------------------------------------------------------------------ terugzetten (12.4)

type Kandidaat = { token: string; data: ReturnType<typeof backupData>; hoezen: Record<string, Buffer>; tijd: number; bron: string }
const kandidaten = new Map<string, Kandidaat>()

export async function leesBackup(buf: Buffer, bron: string): Promise<Kandidaat> {
  let data: any
  const hoezen: Record<string, Buffer> = {}
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buf)
    const j = zip.file('fonotheek-backup.json')
    if (!j) throw new Error('Geen fonotheek-backup.json in dit zip-bestand')
    data = JSON.parse(await j.async('string'))
    for (const f of Object.values(zip.files)) if (f.name.startsWith('hoezen/') && !f.dir) hoezen[basename(f.name)] = await f.async('nodebuffer')
  } else data = JSON.parse(buf.toString('utf8'))
  if (data?.formaat !== 'fonotheek-backup' || !data.tabellen) throw new Error('Dit is geen back-up van de Fonotheek')
  const k = { token: randomUUID(), data, hoezen, tijd: Date.now(), bron }
  kandidaten.set(k.token, k)
  for (const [t, v] of kandidaten) if (Date.now() - v.tijd > 3600_000) kandidaten.delete(t)
  return k
}

/** Controle-overzicht: wat wordt er toegevoegd, gewijzigd of verwijderd. */
export function vergelijk(k: Kandidaat) {
  const telling = (tabel: string, sleutel: string, vergelijkVelden?: string[]) => {
    const huidig = new Map(all<any>(`SELECT * FROM ${tabel}`).map((r) => [String(r[sleutel]), r]))
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
    titels: telling('titels', 'id', ['titelnummer', 'fonos_data', 'zichtbaar', 'uitgelicht', 'fonos_verhaal', 'ai_tekst']),
    exemplaren: telling('exemplaren', 'id'),
    fonos_aanpassingen: { huidig: fonosAanpassingen(all('SELECT fonos_data FROM titels')), backup: fonosAanpassingen(k.data.tabellen.titels ?? []) },
    configuratie: {
      genreknoppen: telling('genreknoppen', 'id'),
      genre_koppelingen: telling('genre_koppelingen', 'id'),
      selecties: telling('selecties', 'id'),
      instellingen: telling('instellingen', 'sleutel'),
      platenspelers: telling('platenspelers', 'nummer'),
    },
    open_aanvragen: get<{ n: number }>("SELECT COUNT(*) n FROM aanvragen WHERE status IN ('ingediend', 'uitgegeven')")!.n,
    hoezen: Object.keys(k.hoezen).length,
  }
}

export async function zetTerug(token: string, bevestiging: string, wie: Wie) {
  if (bevestiging !== 'TERUGZETTEN') throw new Error('Typ TERUGZETTEN om te bevestigen')
  const k = kandidaten.get(token)
  if (!k) throw new Error('Het controle-overzicht is verlopen. Kies de back-up opnieuw.')
  // Vlak voor het terugzetten: automatisch een back-up van de huidige stand.
  const voor = await maakBackup('voor_terugzetten', wie)
  sluitAllesAf('terugzetten', wie)
  const d = db()
  d.exec('PRAGMA foreign_keys = OFF')
  d.exec('BEGIN IMMEDIATE')
  try {
    // Tabellen leegmaken in omgekeerde volgorde, dan vullen.
    for (const t of [...TABELLEN].reverse()) if (t !== 'wijzigingslog') run(`DELETE FROM ${t}`)
    for (const t of TABELLEN) {
      if (t === 'wijzigingslog') continue // het log blijft doorlopen; de geschiedenis uit de back-up wordt toegevoegd
      for (const r of k.data.tabellen[t] ?? []) {
        const cols = Object.keys(r)
        d.prepare(`INSERT OR REPLACE INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => r[c]))
      }
    }
    const bekend = new Set(all<{ id: number }>('SELECT id FROM wijzigingslog').map((r) => r.id))
    for (const r of k.data.tabellen.wijzigingslog ?? []) if (!bekend.has(r.id)) {
      const cols = Object.keys(r)
      d.prepare(`INSERT INTO wijzigingslog (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => r[c]))
    }
    // Open aanvragen uit de back-up zijn niet meer actueel.
    run("UPDATE aanvragen SET status = 'afgesloten', afgesloten_op = datetime('now'), afgesloten_door = 'terugzetten' WHERE status IN ('ingediend', 'uitgegeven')")
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  } finally {
    d.exec('PRAGMA foreign_keys = ON')
  }
  for (const [naam, buf] of Object.entries(k.hoezen)) writeFileSync(join(UPLOAD_DIR, basename(naam)), buf)
  kandidaten.delete(token)
  log(wie, 'back-up teruggezet', { type: 'backup', label: k.bron, nieuw: { gemaakt: k.data.gemaakt, back_up_vooraf: voor.bestand } })
  markeerVuil()
  aanvragenGewijzigd()
  beschikbaarheidGewijzigd()
  return { back_up_vooraf: voor.bestand }
}
