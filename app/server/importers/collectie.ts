// Bulkimport van de gebruikscollectie (10.6): Excel of CSV met objectnummer, titelnummer en optioneel vindcode.
// Eerst een controle-overzicht zonder iets te wijzigen; daarna voert de redacteur per categorie door.
import ExcelJS from 'exceljs'
import { randomUUID } from 'node:crypto'
import { all, db, get, run } from '../db.ts'
import { log, type Wie } from '../log.ts'
import { koppelLosseExemplaren } from './muziekweb-verwerk.ts'
import { beschikbaarheidGewijzigd } from '../events.ts'
import { OPEN_ITEMS_SQL } from '../titels.ts'

export type Regel = { objectnummer: string | null; titelnummer: string | null; vindcode: string | null; bron: string; regel: number }

const RE_OBJECT = /^\d{5,}$/
const RE_TITEL = /^[A-Z]{2,4}\d{3,}$/
const KOP_VINDCODE = /^(vindcode|standplaats|locatie)$/i
const KOP_OBJECT = /^(objectnummer|objectnr|object|plessey)$/i
const KOP_TITEL = /^(titelnummer|titlenumber|titelnr|catalogusnummer|catalogusnr\.?)$/i

/** Haalt objectnummer en titelnummer uit een regel, ongeacht kolomvolgorde of "titel;object"-notatie. */
function ontleedRegel(cellen: string[], kop: { vindcode: number; object: number; titel: number }, bron: string, regel: number): Regel | null {
  let objectnummer: string | null = null
  let titelnummer: string | null = null
  const vindcode = kop.vindcode >= 0 ? (cellen[kop.vindcode]?.trim() || null) : null
  const kandidaten = (i: number) => (cellen[i] ?? '').split(';').map((x) => x.trim().toUpperCase())
  if (kop.object >= 0) objectnummer = kandidaten(kop.object).find((x) => RE_OBJECT.test(x)) ?? null
  if (kop.titel >= 0) titelnummer = kandidaten(kop.titel).find((x) => RE_TITEL.test(x)) ?? null
  cellen.forEach((_, i) => {
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
  return { vindcode: idx(KOP_VINDCODE), object: idx(KOP_OBJECT), titel: idx(KOP_TITEL) }
}

function regelsUitTabel(rijen: string[][], bron: string): Regel[] {
  if (!rijen.length) return []
  let kop = kopIndex(rijen[0])
  const heeftKop = kop.vindcode >= 0 || kop.object >= 0 || kop.titel >= 0
  if (!heeftKop) kop = { vindcode: -1, object: -1, titel: -1 }
  const out: Regel[] = []
  rijen.slice(heeftKop ? 1 : 0).forEach((cellen, i) => {
    const r = ontleedRegel(cellen, kop, bron, i + (heeftKop ? 2 : 1))
    if (r) out.push(r)
  })
  return out
}

/** Leest een .xlsx of .csv. Tabbladen met prefix OUD_ worden overgeslagen (open punt O-6). */
export async function leesBestand(buf: Buffer, naam: string): Promise<{ regels: Regel[]; overgeslagen: string[] }> {
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
  const rijen = regelsTekst.map((l) => (sep ? l.split(sep) : [l]).map((c) => c.replace(/^"|"$/g, '')))
  return { regels: regelsUitTabel(rijen, naam), overgeslagen }
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

const analyses = new Map<string, Analyse & { tijd: number }>()

export function analyseer(regels: Regel[], bestand: string, overgeslagen: string[] = []): Analyse {
  const cat: Record<Categorie, Item[]> = { nieuw: [], gewijzigd: [], ontbrekend: [], onbekend: [], dubbel: [], zonder_titelnummer: [] }
  const bestaand = new Map<string, any>()
  for (const e of all<any>('SELECT id, objectnummer, titelnummer, vindcode, status FROM exemplaren')) bestaand.set(e.objectnummer, e)
  const bekend = new Set(all<{ t: string }>('SELECT titelnummer t FROM mw_dump UNION SELECT titelnummer FROM titels WHERE titelnummer IS NOT NULL').map((r) => r.t))
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
  const token = randomUUID()
  const a: Analyse = { token, bestand, overgeslagen, totaal: regels.length, categorieen: cat }
  analyses.set(token, { ...a, tijd: Date.now() })
  for (const [k, v] of analyses) if (Date.now() - v.tijd > 3600_000) analyses.delete(k)
  return a
}

export function samenvatting(a: Analyse) {
  return {
    token: a.token, bestand: a.bestand, overgeslagen: a.overgeslagen, totaal: a.totaal,
    categorieen: (Object.keys(CATEGORIEEN) as Categorie[]).map((k) => ({ sleutel: k, naam: CATEGORIEEN[k], aantal: a.categorieen[k].length, voorbeelden: a.categorieen[k].slice(0, 100) })),
  }
}

/** Voert de gekozen categorieën door. */
export function voerDoor(token: string, keuze: Categorie[], wie: Wie) {
  const a = analyses.get(token)
  if (!a) throw new Error('Het controle-overzicht is verlopen. Upload het bestand opnieuw.')
  const telling: Record<string, number> = {}
  const d = db()
  const open = new Set(all<{ exemplaar_id: number }>(OPEN_ITEMS_SQL).map((r) => r.exemplaar_id))
  const overgeslagenInGebruik: string[] = []
  d.exec('BEGIN IMMEDIATE')
  try {
    const nieuwExemplaar = d.prepare('INSERT OR IGNORE INTO exemplaren (objectnummer, titelnummer, vindcode, bron) VALUES (?, ?, ?, ?)')
    for (const k of keuze) {
      const items = a.categorieen[k] ?? []
      telling[k] = 0
      for (const it of items) {
        if (k === 'nieuw' || k === 'onbekend' || k === 'zonder_titelnummer') {
          if (it.bestaand) {
            run("UPDATE exemplaren SET titelnummer = ?, titel_id = NULL, vindcode = COALESCE(?, vindcode), gewijzigd = datetime('now') WHERE id = ?", it.titelnummer, it.vindcode, it.bestaand.id)
          } else {
            nieuwExemplaar.run(it.objectnummer, it.titelnummer, it.vindcode, it.bron)
          }
        } else if (k === 'gewijzigd') {
          if (open.has(it.bestaand!.id)) { overgeslagenInGebruik.push(it.objectnummer!); continue }
          const tn = it.titelnummer !== it.bestaand!.titelnummer
          run(`UPDATE exemplaren SET titelnummer = ?, ${tn ? 'titel_id = NULL,' : ''} vindcode = COALESCE(?, vindcode), gewijzigd = datetime('now') WHERE id = ?`, it.titelnummer, it.vindcode, it.bestaand!.id)
        } else if (k === 'ontbrekend') {
          if (open.has(it.bestaand!.id)) { overgeslagenInGebruik.push(it.objectnummer!); continue }
          run("UPDATE exemplaren SET status = 'uit_collectie', reden_afvoer = 'overig', toelichting_afvoer = ?, gewijzigd = datetime('now') WHERE id = ?", `Niet in bulkimport ${a.bestand}`, it.bestaand!.id)
        } else if (k === 'dubbel') {
          run("INSERT INTO import_issues (soort, objectnummer, titelnummer, vindcode, bron) VALUES ('dubbel_objectnummer', ?, ?, ?, ?)", it.objectnummer, it.titelnummer, it.vindcode, `${it.bron}, regel ${it.regel}`)
        }
        telling[k]++
      }
    }
    // Exemplaren met een titelnummer: koppelen aan een bestaande titel.
    run(`UPDATE exemplaren SET titel_id = (SELECT id FROM titels t WHERE t.titelnummer = exemplaren.titelnummer)
          WHERE titel_id IS NULL AND titelnummer IS NOT NULL`)
    d.exec('COMMIT')
  } catch (e) { d.exec('ROLLBACK'); throw e }
  const nieuweTitels = koppelLosseExemplaren()
  analyses.delete(token)
  const rapport = { bestand: a.bestand, doorgevoerd: telling, nieuwe_titels: nieuweTitels, overgeslagen_in_gebruik: overgeslagenInGebruik, tabbladen_overgeslagen: a.overgeslagen }
  const id = Number(run("INSERT INTO imports (soort, gebruiker, rapport) VALUES ('collectie', ?, ?)", wie.naam, JSON.stringify(rapport)).lastInsertRowid)
  log(wie, 'bulkimport collectie', { type: 'import', id, label: a.bestand, nieuw: rapport })
  beschikbaarheidGewijzigd()
  return rapport
}

export const issueTelling = () => get<{ n: number }>("SELECT COUNT(*) n FROM import_issues WHERE afgehandeld = 0")!.n
