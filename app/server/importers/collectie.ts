// Bulkimport van de gebruikscollectie (10.6): Excel of CSV met objectnummer, titelnummer en optioneel vindcode.
// Eerst een controle-overzicht zonder iets te wijzigen; daarna voert de redacteur per categorie door.
import ExcelJS from 'exceljs'
import { randomUUID } from 'node:crypto'
import { all, get, insert, run, tx } from '../db.ts'
import { log, type Wie } from '../log.ts'
import { koppelLosseExemplaren } from './muziekweb-verwerk.ts'
import { beschikbaarheidGewijzigd } from '../events.ts'
import { OPEN_ITEMS_SQL } from '../titels.ts'

export type Regel = { objectnummer: string | null; titelnummer: string | null; vindcode: string | null; bron: string; regel: number }

const RE_OBJECT = /^\d{5,}$/
// In de kolom objectnummer ook afwijkende waarden uit de bron (bv. z100190255, 80A241355).
const RE_OBJECT_KOLOM = /^[A-Z0-9]{5,}$/
const RE_TITEL = /^[A-Z]{2,4}\d{3,}$/
const KOP_VINDCODE = /^(vindcode|standplaats|locatie)$/i
const KOP_OBJECT = /^(objectnummer|objectnr|object|plessey)$/i
const KOP_TITEL = /^(titelnummer|titlenumber|titelnr|catalogusnummer|catalogusnr\.?)$/i

/** Haalt objectnummer en titelnummer uit een regel, ongeacht kolomvolgorde of "titel;object"-notatie. */
function ontleedRegel(cellen: string[], kop: { vindcode: number; object: number; titel: number; bron: number }, bron: string, regel: number): Regel | null {
  let objectnummer: string | null = null
  let titelnummer: string | null = null
  const vindcode = kop.vindcode >= 0 ? (cellen[kop.vindcode]?.trim() || null) : null
  const kandidaten = (i: number) => (cellen[i] ?? '').split(';').map((x) => x.trim().toUpperCase())
  if (kop.object >= 0) objectnummer = kandidaten(kop.object).find((x) => RE_OBJECT_KOLOM.test(x)) ?? null
  if (kop.titel >= 0) titelnummer = kandidaten(kop.titel).find((x) => RE_TITEL.test(x)) ?? null
  // Met bekende kolomkoppen alleen die kolommen; anders alle cellen doorzoeken.
  if (!(kop.object >= 0 && kop.titel >= 0)) cellen.forEach((_, i) => {
    if (i === kop.vindcode) return
    for (const x of kandidaten(i)) {
      if (!objectnummer && RE_OBJECT.test(x)) objectnummer = x
      else if (!titelnummer && RE_TITEL.test(x)) titelnummer = x
    }
  })
  if (!objectnummer && !titelnummer) return null
  return { objectnummer, titelnummer, vindcode, bron, regel }
}

function kopIndex(cellen: string[]) {
  const idx = (re: RegExp) => cellen.findIndex((c) => re.test((c ?? '').trim()))
  return { vindcode: idx(KOP_VINDCODE), object: idx(KOP_OBJECT), titel: idx(KOP_TITEL), bron: idx(/^bron$/i) }
}

/** Splitst een CSV-regel, met velden tussen dubbele aanhalingstekens. */
function splitsCsv(regel: string, sep: string): string[] {
  const uit: string[] = []
  let veld = '', tussen = false
  for (let i = 0; i < regel.length; i++) {
    const c = regel[i]
    if (tussen) {
      if (c === '"' && regel[i + 1] === '"') { veld += '"'; i++ }
      else if (c === '"') tussen = false
      else veld += c
    } else if (c === '"') tussen = true
    else if (c === sep) { uit.push(veld); veld = '' }
    else veld += c
  }
  uit.push(veld)
  return uit
}

const IS_OUD = /(^|\/\s*)OUD/i

function regelsUitTabel(rijen: string[][], bron: string, overgeslagen: string[] = []): Regel[] {
  if (!rijen.length) return []
  let kop = kopIndex(rijen[0])
  const heeftKop = kop.vindcode >= 0 || kop.object >= 0 || kop.titel >= 0
  if (!heeftKop) kop = { vindcode: -1, object: -1, titel: -1, bron: -1 }
  const out: Regel[] = []
  rijen.slice(heeftKop ? 1 : 0).forEach((cellen, i) => {
    // Een kolom "bron" (bestand / tabblad) per regel: OUD_-tabbladen overslaan (open punt O-6).
    const eigenBron = kop.bron >= 0 ? (cellen[kop.bron] ?? '').trim() : ''
    if (eigenBron && IS_OUD.test((eigenBron.split('/').pop() ?? '').trim())) { if (!overgeslagen.includes(eigenBron)) overgeslagen.push(eigenBron); return }
    const zonderBron = kop.bron >= 0 ? cellen.map((c, j) => (j === kop.bron ? '' : c)) : cellen
    const r = ontleedRegel(zonderBron, kop, eigenBron ? `${bron}: ${eigenBron}` : bron, i + (heeftKop ? 2 : 1))
    if (r) out.push(r)
  })
  return out
}

/** Leest een .xlsx of .csv. Tabbladen met prefix OUD_ worden overgeslagen (open punt O-6). */
/**
 * Oude lijsten (open punt O-6) niet importeren: tabbladen met prefix OUD_, en tabbladen waarin geen
 * enkele regel een titelnummer heeft (in de Populair-lijst heten die gewoon "HA-HL" e.d.).
 */
function zonderOudeLijsten(r: { regels: Regel[]; overgeslagen: string[] }) {
  const metTitel = new Map<string, number>()
  for (const x of r.regels) metTitel.set(x.bron, (metTitel.get(x.bron) ?? 0) + (x.titelnummer ? 1 : 0))
  const oud = new Set([...metTitel].filter(([, n]) => n === 0).map(([b]) => b))
  for (const b of oud) if (!r.overgeslagen.includes(b)) r.overgeslagen.push(b)
  return { regels: r.regels.filter((x) => !oud.has(x.bron)), overgeslagen: r.overgeslagen }
}

export async function leesBestand(buf: Buffer, naam: string): Promise<{ regels: Regel[]; overgeslagen: string[] }> {
  return zonderOudeLijsten(await leesBestandRuw(buf, naam))
}

async function leesBestandRuw(buf: Buffer, naam: string): Promise<{ regels: Regel[]; overgeslagen: string[] }> {
  const overgeslagen: string[] = []
  if (/\.xlsx$/i.test(naam)) {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any)
    const regels: Regel[] = []
    wb.eachSheet((ws) => {
      if (/^OUD/i.test(ws.name)) { overgeslagen.push(ws.name); return }
      const rijen: string[][] = []
      ws.eachRow({ includeEmpty: false }, (row) => {
        const vals = (row.values as any[]).slice(1).map((v) => (v == null ? '' : typeof v === 'object' && 'text' in v ? String(v.text) : typeof v === 'object' && 'result' in v ? String(v.result) : String(v)))
        rijen.push(vals)
      })
      regels.push(...regelsUitTabel(rijen, `${naam} / ${ws.name}`))
    })
    return { regels, overgeslagen }
  }
  const tekst = buf.toString('utf8').replace(/^﻿/, '')
  const regelsTekst = tekst.split(/\r?\n/).filter((l) => l.trim())
  const sep = regelsTekst[0]?.includes('\t') ? '\t' : (regelsTekst[0]?.split(',').length ?? 0) > 1 ? ',' : null
  // Zonder tab of komma blijft de regel heel; ontleedRegel splitst dan zelf op puntkomma.
  const rijen = regelsTekst.map((l) => (sep ? splitsCsv(l, sep) : [l]))
  return { regels: regelsUitTabel(rijen, naam, overgeslagen), overgeslagen }
}

// ------------------------------------------------------------------ controle-overzicht

export const CATEGORIEEN = {
  nieuw: 'Nieuwe exemplaren',
  gewijzigd: 'Bestaande exemplaren met gewijzigde koppeling',
  ontbrekend: 'In de collectie, niet in het bestand (voorstel: afvoeren)',
  onbekend: 'Onbekende titelnummers',
  dubbel: 'Dubbele objectnummers',
  zonder_titelnummer: 'Regels zonder titelnummer',
} as const
export type Categorie = keyof typeof CATEGORIEEN

type Item = Regel & { bestaand?: { id: number; titelnummer: string | null; vindcode: string | null } }
export type Analyse = { token: string; bestand: string; overgeslagen: string[]; totaal: number; categorieen: Record<Categorie, Item[]> }

async function bewaarAnalyse(a: Analyse) {
  await run("DELETE FROM taken WHERE soort = 'bulkimport' AND tijd < nu('-2 hours')")
  await run("INSERT INTO taken (id, soort, data) VALUES (?, 'bulkimport', ?)", a.token, JSON.stringify(a))
}

export async function analyseer(regels: Regel[], bestand: string, overgeslagen: string[] = []): Promise<Analyse> {
  const cat: Record<Categorie, Item[]> = { nieuw: [], gewijzigd: [], ontbrekend: [], onbekend: [], dubbel: [], zonder_titelnummer: [] }
  const bestaand = new Map<string, any>()
  for (const e of await all<any>('SELECT id, objectnummer, titelnummer, vindcode, status FROM exemplaren')) bestaand.set(e.objectnummer, e)
  const bekend = new Set((await all<{ t: string }>('SELECT titelnummer AS t FROM mw_dump UNION SELECT titelnummer FROM titels WHERE titelnummer IS NOT NULL')).map((r) => r.t))
  const gezien = new Map<string, number>()
  for (const r of regels) if (r.objectnummer) gezien.set(r.objectnummer, (gezien.get(r.objectnummer) ?? 0) + 1)
  const eerste = new Set<string>()
  for (const r of regels) {
    if (!r.objectnummer) continue // zonder objectnummer is er geen exemplaar
    const b = bestaand.get(r.objectnummer)
    const item: Item = { ...r, bestaand: b ? { id: b.id, titelnummer: b.titelnummer, vindcode: b.vindcode } : undefined }
    if (eerste.has(r.objectnummer)) { cat.dubbel.push(item); continue }
    eerste.add(r.objectnummer)
    if (!r.titelnummer) { if (!b || b.titelnummer) cat.zonder_titelnummer.push(item); continue }
    if (b && b.titelnummer === r.titelnummer && (!r.vindcode || r.vindcode === b.vindcode)) continue
    if (!bekend.has(r.titelnummer)) { cat.onbekend.push(item); continue }
    if (b) cat.gewijzigd.push(item)
    else cat.nieuw.push(item)
  }
  for (const [obj, e] of bestaand) {
    if (e.status === 'in_collectie' && !gezien.has(obj)) cat.ontbrekend.push({ objectnummer: obj, titelnummer: e.titelnummer, vindcode: e.vindcode, bron: 'collectie', regel: 0, bestaand: { id: e.id, titelnummer: e.titelnummer, vindcode: e.vindcode } })
  }
  const a: Analyse = { token: randomUUID(), bestand, overgeslagen, totaal: regels.length, categorieen: cat }
  await bewaarAnalyse(a)
  return a
}

export function samenvatting(a: Analyse) {
  return {
    token: a.token, bestand: a.bestand, overgeslagen: a.overgeslagen, totaal: a.totaal,
    categorieen: (Object.keys(CATEGORIEEN) as Categorie[]).map((k) => ({ sleutel: k, naam: CATEGORIEEN[k], aantal: a.categorieen[k].length, voorbeelden: a.categorieen[k].slice(0, 100) })),
  }
}

const recordset = (rijen: object[]) => JSON.stringify(rijen)

/** Voert de gekozen categorieën door. */
export async function voerDoor(token: string, keuze: Categorie[], wie: Wie) {
  const t = await get<{ data: string }>("SELECT data FROM taken WHERE id = ? AND soort = 'bulkimport'", token)
  if (!t) throw new Error('Het controle-overzicht is verlopen. Upload het bestand opnieuw.')
  const a: Analyse = JSON.parse(t.data)
  const telling: Record<string, number> = {}
  const open = new Set((await all<{ exemplaar_id: number }>(OPEN_ITEMS_SQL)).map((r) => r.exemplaar_id))
  const overgeslagenInGebruik: string[] = []
  await tx(async () => {
    for (const k of keuze) {
      const items = a.categorieen[k] ?? []
      telling[k] = 0
      if (k === 'nieuw' || k === 'onbekend' || k === 'zonder_titelnummer') {
        const nieuw = items.filter((i) => !i.bestaand).map((i) => ({ objectnummer: i.objectnummer, titelnummer: i.titelnummer, vindcode: i.vindcode, bron: i.bron }))
        for (let j = 0; j < nieuw.length; j += 5000) {
          await run(`INSERT INTO exemplaren (objectnummer, titelnummer, vindcode, bron)
            SELECT objectnummer, titelnummer, vindcode, bron FROM jsonb_to_recordset(?::jsonb) AS x(objectnummer text, titelnummer text, vindcode text, bron text)
            ON CONFLICT (objectnummer) DO NOTHING`, recordset(nieuw.slice(j, j + 5000)))
        }
        // Bestaande exemplaren in een open aanvraag blijven ongemoeid (net als bij "gewijzigd").
        const bij = items.filter((i) => i.bestaand && (!open.has(i.bestaand.id) || (overgeslagenInGebruik.push(i.objectnummer!), false)))
          .map((i) => ({ id: i.bestaand!.id, titelnummer: i.titelnummer, vindcode: i.vindcode }))
        if (bij.length) await run(`UPDATE exemplaren e SET titelnummer = x.titelnummer, titel_id = NULL, vindcode = COALESCE(x.vindcode, e.vindcode), gewijzigd = nu()
            FROM jsonb_to_recordset(?::jsonb) AS x(id int, titelnummer text, vindcode text) WHERE e.id = x.id`, recordset(bij))
        telling[k] = nieuw.length + bij.length
      } else if (k === 'gewijzigd' || k === 'ontbrekend') {
        const vrij = items.filter((i) => { if (open.has(i.bestaand!.id)) { overgeslagenInGebruik.push(i.objectnummer!); return false } return true })
        if (k === 'gewijzigd' && vrij.length) await run(`UPDATE exemplaren e SET titelnummer = x.titelnummer,
            titel_id = CASE WHEN e.titelnummer IS DISTINCT FROM x.titelnummer THEN NULL ELSE e.titel_id END, vindcode = COALESCE(x.vindcode, e.vindcode), gewijzigd = nu()
            FROM jsonb_to_recordset(?::jsonb) AS x(id int, titelnummer text, vindcode text) WHERE e.id = x.id`,
          recordset(vrij.map((i) => ({ id: i.bestaand!.id, titelnummer: i.titelnummer, vindcode: i.vindcode }))))
        if (k === 'ontbrekend' && vrij.length) await run(`UPDATE exemplaren SET status = 'uit_collectie', reden_afvoer = 'overig', toelichting_afvoer = ?, gewijzigd = nu()
            WHERE id = ANY(?::int[])`, `Niet in bulkimport ${a.bestand}`, `{${vrij.map((i) => i.bestaand!.id).join(',')}}`)
        telling[k] = vrij.length
      } else if (k === 'dubbel') {
        await run(`INSERT INTO import_issues (soort, objectnummer, titelnummer, vindcode, bron)
          SELECT 'dubbel_objectnummer', objectnummer, titelnummer, vindcode, bron FROM jsonb_to_recordset(?::jsonb) AS x(objectnummer text, titelnummer text, vindcode text, bron text)`,
          recordset(items.map((i) => ({ objectnummer: i.objectnummer, titelnummer: i.titelnummer, vindcode: i.vindcode, bron: `${i.bron}, regel ${i.regel}` }))))
        telling[k] = items.length
      }
    }
  })
  const nieuweTitels = await koppelLosseExemplaren()
  await run('DELETE FROM taken WHERE id = ?', token)
  const rapport = { bestand: a.bestand, doorgevoerd: telling, nieuwe_titels: nieuweTitels, overgeslagen_in_gebruik: overgeslagenInGebruik, tabbladen_overgeslagen: a.overgeslagen }
  const id = await insert("INSERT INTO imports (soort, gebruiker, rapport) VALUES ('collectie', ?, ?)", wie.naam, JSON.stringify(rapport))
  await log(wie, 'bulkimport collectie', { type: 'import', id, label: a.bestand, nieuw: rapport })
  await beschikbaarheidGewijzigd()
  return rapport
}
