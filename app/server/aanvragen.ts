// Aanvragen en hun statussen (7.9, 8).
import { all, db, get, instellingen, run } from './db.ts'
import { BEZOEKER, log, type Wie } from './log.ts'
import { OPEN_ITEMS_SQL, vindcode } from './titels.ts'
import { aanvragenGewijzigd, beschikbaarheidGewijzigd } from './events.ts'
import { stuurMail } from './mail.ts'

export class AanvraagFout extends Error {
  code: string
  extra: Record<string, unknown>
  constructor(code: string, bericht: string, extra: Record<string, unknown> = {}) {
    super(bericht)
    this.code = code
    this.extra = extra
  }
}

const OPEN = "('ingediend', 'uitgegeven')"

export function openAanvraagVoorSpeler(nummer: number) {
  return get<any>(`SELECT * FROM aanvragen WHERE platenspeler = ? AND status IN ${OPEN} ORDER BY id DESC LIMIT 1`, nummer)
}

export function platenspelers() {
  return all<any>(`SELECT p.nummer, p.actief, (SELECT a.id FROM aanvragen a WHERE a.platenspeler = p.nummer AND a.status IN ${OPEN} LIMIT 1) AS open_aanvraag
    FROM platenspelers p ORDER BY p.nummer`).map((p) => ({ nummer: p.nummer, actief: !!p.actief, bezet: p.open_aanvraag != null }))
}

/** Kiest per titel een beschikbaar exemplaar (of het gevraagde, als dat beschikbaar is). */
function kiesExemplaar(titelId: number, voorkeur?: number | null): number | null {
  const vrij = all<{ id: number }>(`SELECT e.id FROM exemplaren e JOIN titels t ON t.id = e.titel_id
    WHERE e.titel_id = ? AND e.status = 'in_collectie' AND t.zichtbaar = 1 AND e.id NOT IN (${OPEN_ITEMS_SQL}) ORDER BY e.id`, titelId)
  if (!vrij.length) return null
  return vrij.find((e) => e.id === voorkeur)?.id ?? vrij[0].id
}

function volgendBestelnummer(): number {
  const r = get<{ m: number | null }>('SELECT MAX(bestelnummer) m FROM aanvragen')
  return Math.max(1000, r?.m ?? 1000) + 1
}

/** Sluit een aanvraag af: exemplaren worden weer beschikbaar. */
export function sluitAf(id: number, door: string, wie: Wie) {
  const a = get<any>('SELECT * FROM aanvragen WHERE id = ?', id)
  if (!a || !['ingediend', 'uitgegeven'].includes(a.status)) return false
  run("UPDATE aanvragen SET status = 'afgesloten', afgesloten_op = datetime('now'), afgesloten_door = ? WHERE id = ?", door, id)
  log(wie, 'aanvraag afgesloten', { type: 'aanvraag', id, label: `#${a.bestelnummer}`, veld: 'status', oud: a.status, nieuw: `afgesloten (${door})` })
  return true
}

export function dienAanvraagIn(inv: { platenspeler: number; titels: { titel_id: number; exemplaar_id?: number | null }[]; bezetAfsluiten?: boolean }) {
  const inst = instellingen()
  const titels = inv.titels ?? []
  if (!titels.length) throw new AanvraagFout('leeg', 'Je aanvraag is leeg.')
  if (titels.length > inst.max_titels) throw new AanvraagFout('te_veel', `Je kunt maximaal ${inst.max_titels} titels tegelijk aanvragen.`)
  if (new Set(titels.map((t) => t.titel_id)).size !== titels.length) throw new AanvraagFout('dubbel', 'Een titel staat dubbel in je aanvraag.')
  const resultaat = (() => {
    db().exec('BEGIN IMMEDIATE')
    try {
      const speler = get<any>('SELECT * FROM platenspelers WHERE nummer = ?', inv.platenspeler)
      if (!speler || !speler.actief) throw new AanvraagFout('speler_inactief', 'Deze platenspeler is nu niet beschikbaar. Kies een andere.')
      const open = openAanvraagVoorSpeler(inv.platenspeler)
      if (open && !inv.bezetAfsluiten) throw new AanvraagFout('bezet', 'Op deze speler loopt nog een aanvraag. Wil je die afsluiten?')
      const keuze: { titel_id: number; exemplaar_id: number }[] = []
      const niet: number[] = []
      for (const t of titels) {
        const e = kiesExemplaar(t.titel_id, t.exemplaar_id)
        if (e == null) niet.push(t.titel_id)
        else keuze.push({ titel_id: t.titel_id, exemplaar_id: e })
      }
      if (niet.length) throw new AanvraagFout('niet_beschikbaar', 'Een of meer titels zijn intussen in gebruik.', { titelIds: niet })
      if (open) sluitAf(open.id, 'bezoeker', BEZOEKER)
      const nr = volgendBestelnummer()
      const id = Number(run('INSERT INTO aanvragen (bestelnummer, platenspeler) VALUES (?, ?)', nr, inv.platenspeler).lastInsertRowid)
      for (const k of keuze) run('INSERT INTO aanvraag_items (aanvraag_id, titel_id, exemplaar_id) VALUES (?, ?, ?)', id, k.titel_id, k.exemplaar_id)
      db().exec('COMMIT')
      return { id, bestelnummer: nr, platenspeler: inv.platenspeler, vorigeAfgesloten: !!open, titelIds: keuze.map((k) => k.titel_id) }
    } catch (e) {
      db().exec('ROLLBACK')
      throw e
    }
  })()
  aanvragenGewijzigd({ nieuw: resultaat.bestelnummer })
  beschikbaarheidGewijzigd(resultaat.titelIds)
  if (inst.melding_email_aan && inst.melding_email_adres) {
    // Open punt O-9: optionele e-mailmelding, standaard uit.
    stuurMail(inst.melding_email_adres, `Nieuwe aanvraag #${resultaat.bestelnummer} voor platenspeler ${resultaat.platenspeler}`,
      `Er is een nieuwe aanvraag (#${resultaat.bestelnummer}) voor platenspeler ${resultaat.platenspeler} met ${resultaat.titelIds.length} titel(s).`).catch(() => {})
  }
  return resultaat
}

// ------------------------------------------------------------------ medewerker

export function aanvraagDetail(id: number) {
  const a = get<any>('SELECT * FROM aanvragen WHERE id = ?', id)
  if (!a) return null
  const items = all<any>(`SELECT i.id, i.titel_id, i.exemplaar_id, i.verwijderd, i.reden, t.d_titel AS titel, t.d_artiesten AS artiesten,
      t.d_jaar AS jaar, t.d_drager AS drager, t.d_hoes AS hoes, e.objectnummer, e.vindcode, e.titelnummer
    FROM aanvraag_items i JOIN titels t ON t.id = i.titel_id JOIN exemplaren e ON e.id = i.exemplaar_id WHERE i.aanvraag_id = ?`, id)
    .map((i) => ({ ...i, vindcode: vindcode(i) }))
  // Gesorteerd op vindcode: zo kan de medewerker in één ronde door het archief (9).
  items.sort((x, y) => (x.verwijderd - y.verwijderd) || String(x.vindcode ?? '~').localeCompare(String(y.vindcode ?? '~'), 'nl', { numeric: true }))
  return { ...a, weergave_status: weergaveStatus(a), items }
}

/** Status zoals op het medewerkersscherm: Nieuw, Bezig (wordt opgehaald), Klaar (bij de speler). */
export function weergaveStatus(a: any): string {
  if (a.status === 'ingediend') return a.opgepakt_op ? 'bezig' : 'nieuw'
  if (a.status === 'uitgegeven') return 'klaar'
  return a.status
}

export function lijstAanvragen(tab: 'actief' | 'afgerond') {
  const rows = all<any>(tab === 'actief'
    ? `SELECT * FROM aanvragen WHERE status IN ${OPEN} ORDER BY id DESC`
    : `SELECT * FROM aanvragen WHERE status IN ('afgesloten', 'geannuleerd') AND ingediend_op > datetime('now', '-2 days') ORDER BY id DESC LIMIT 200`)
  return rows.map((a) => {
    const items = all<any>(`SELECT t.d_hoes AS hoes, t.d_titel AS titel FROM aanvraag_items i JOIN titels t ON t.id = i.titel_id
      WHERE i.aanvraag_id = ? AND i.verwijderd = 0`, a.id)
    return { ...a, weergave_status: weergaveStatus(a), aantal: items.length, hoezen: items.slice(0, 2).map((i) => i.hoes) }
  })
}

function wijzigStatus(id: number, van: string[], sql: string, actie: string, wie: Wie, ...p: any[]) {
  const a = get<any>('SELECT * FROM aanvragen WHERE id = ?', id)
  if (!a) throw new AanvraagFout('niet_gevonden', 'Aanvraag niet gevonden')
  if (!van.includes(a.status)) throw new AanvraagFout('status', 'Deze actie kan niet in de huidige status.')
  run(sql, ...p, id)
  log(wie, actie, { type: 'aanvraag', id, label: `#${a.bestelnummer}` })
  aanvragenGewijzigd()
  beschikbaarheidGewijzigd()
}

export const ophalen = (id: number, wie: Wie) =>
  wijzigStatus(id, ['ingediend'], "UPDATE aanvragen SET opgepakt_op = COALESCE(opgepakt_op, datetime('now')) WHERE id = ?", 'aanvraag wordt opgehaald', wie)
export const uitgeven = (id: number, wie: Wie) =>
  wijzigStatus(id, ['ingediend'], "UPDATE aanvragen SET status = 'uitgegeven', uitgegeven_op = datetime('now'), opgepakt_op = COALESCE(opgepakt_op, datetime('now')) WHERE id = ?", 'aanvraag uitgegeven', wie)
export const annuleren = (id: number, reden: string | null, wie: Wie) =>
  wijzigStatus(id, ['ingediend', 'uitgegeven'], "UPDATE aanvragen SET status = 'geannuleerd', geannuleerd_op = datetime('now'), reden = ? WHERE id = ?", 'aanvraag geannuleerd', wie, reden)
export function vrijgeven(id: number, wie: Wie) {
  if (!sluitAf(id, 'medewerker', wie)) throw new AanvraagFout('status', 'Deze aanvraag is al afgesloten.')
  aanvragenGewijzigd()
  beschikbaarheidGewijzigd()
}

/** Eén titel uit de aanvraag halen (bv. niet te vinden). Is het de laatste, dan wordt de aanvraag geannuleerd. */
export function verwijderItem(aanvraagId: number, itemId: number, reden: string | null, wie: Wie) {
  const a = get<any>('SELECT * FROM aanvragen WHERE id = ?', aanvraagId)
  if (!a || !['ingediend', 'uitgegeven'].includes(a.status)) throw new AanvraagFout('status', 'Deze aanvraag is niet meer open.')
  const item = get<any>('SELECT i.*, t.d_titel FROM aanvraag_items i JOIN titels t ON t.id = i.titel_id WHERE i.id = ? AND i.aanvraag_id = ?', itemId, aanvraagId)
  if (!item || item.verwijderd) throw new AanvraagFout('niet_gevonden', 'Titel niet gevonden in deze aanvraag.')
  run('UPDATE aanvraag_items SET verwijderd = 1, reden = ? WHERE id = ?', reden, itemId)
  log(wie, 'titel uit aanvraag gehaald', { type: 'aanvraag', id: aanvraagId, label: `#${a.bestelnummer}`, veld: 'titel', oud: item.d_titel, nieuw: reden })
  const over = get<{ n: number }>('SELECT COUNT(*) n FROM aanvraag_items WHERE aanvraag_id = ? AND verwijderd = 0', aanvraagId)!.n
  if (over === 0) run("UPDATE aanvragen SET status = 'geannuleerd', geannuleerd_op = datetime('now'), reden = 'Alle titels verwijderd' WHERE id = ?", aanvraagId)
  aanvragenGewijzigd()
  beschikbaarheidGewijzigd([item.titel_id])
}

/** Automatische afsluiting bij sluitingstijd (8). */
export function sluitAllesAf(door: string, wie: Wie): number {
  const open = all<{ id: number }>(`SELECT id FROM aanvragen WHERE status IN ${OPEN}`)
  for (const a of open) sluitAf(a.id, door, wie)
  if (open.length) { aanvragenGewijzigd(); beschikbaarheidGewijzigd() }
  return open.length
}

/** Lang openstaand: langer dan de ingestelde tijd op "ingediend" (9). */
export function minutenOpen(a: { ingediend_op: string }) {
  return Math.floor((Date.now() - Date.parse(a.ingediend_op.replace(' ', 'T') + 'Z')) / 60000)
}
