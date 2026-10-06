// Aanvragen en hun statussen (7.9, 8).
import { VINDCODE_LABEL } from '../shared/velden.ts'
import { all, get, insert, instellingen, run, tx } from './db.ts'
import { randomUUID } from 'node:crypto'
import { BEZOEKER, log, SYSTEEM, type Wie } from './log.ts'
import { OPEN_ITEMS_SQL, vindcoder } from './titels.ts'
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

/** bezet = een bezoeker houdt de speler vast, of er loopt nog een aanvraag op. */
export async function platenspelers() {
  return (await all<any>(`SELECT p.nummer, p.actief, p.sessie IS NOT NULL AS vast, p.bezet_sinds,
      (SELECT a.id FROM aanvragen a WHERE a.platenspeler = p.nummer AND a.status IN ${OPEN} LIMIT 1) AS open_aanvraag
    FROM platenspelers p ORDER BY p.nummer`)).map((p) => ({
    nummer: p.nummer, actief: !!p.actief, bezet: !!p.vast || p.open_aanvraag != null, vastgehouden: !!p.vast, bezet_sinds: p.bezet_sinds ?? null,
  }))
}

// ------------------------------------------------------------------ platenspeler kiezen, vasthouden, vrijgeven

/** Bezoeker kiest een platenspeler (eerste stap in de kiosk). Geeft een sessiecode terug. */
export async function kiesSpeler(nummer: number) {
  const r = await tx(async () => {
    await run('SELECT pg_advisory_xact_lock(4711)')
    const p = await get<any>('SELECT * FROM platenspelers WHERE nummer = ?', nummer)
    if (!p || !p.actief) throw new AanvraagFout('speler_inactief', 'Deze platenspeler is nu niet beschikbaar. Kies een andere.')
    if (p.sessie || (await openAanvraagVoorSpeler(nummer))) throw new AanvraagFout('bezet', 'Deze platenspeler is bezet. Kies een andere.')
    const sessie = randomUUID()
    await run('UPDATE platenspelers SET sessie = ?, bezet_sinds = nu(), laatst_actief = nu() WHERE nummer = ?', sessie, nummer)
    return sessie
  })
  await log(BEZOEKER, 'platenspeler gekozen', { type: 'platenspeler', id: nummer, label: `Platenspeler ${nummer}` })
  await aanvragenGewijzigd()
  return r
}

/** Houdt de speler vast (bij gebruik van de kiosk). false = de speler is intussen vrijgegeven. */
export async function houdSpelerVast(nummer: number, sessie: string) {
  const r = await run('UPDATE platenspelers SET laatst_actief = nu() WHERE nummer = ? AND sessie = ?', nummer, sessie)
  return r.changes > 0
}

export async function spelerVanSessie(nummer: number, sessie?: string | null) {
  return !!sessie && !!(await get('SELECT 1 FROM platenspelers WHERE nummer = ? AND sessie = ?', nummer, sessie))
}

/** Speler vrijgeven: open aanvragen op deze speler afsluiten (exemplaren weer beschikbaar) en de speler vrijmaken. */
export async function geefSpelerVrij(nummer: number, door: 'bezoeker' | 'medewerker' | 'inactiviteit' | 'sluitingstijd', wie: Wie, sessie?: string) {
  if (sessie && !(await spelerVanSessie(nummer, sessie))) return false
  const open = await all<{ id: number }>(`SELECT id FROM aanvragen WHERE platenspeler = ? AND status IN ${OPEN}`, nummer)
  for (const a of open) await sluitAf(a.id, door, wie)
  const r = await run('UPDATE platenspelers SET sessie = NULL, bezet_sinds = NULL, laatst_actief = NULL WHERE nummer = ? AND sessie IS NOT NULL', nummer)
  if (r.changes || open.length) {
    await log(wie, 'platenspeler vrijgegeven', { type: 'platenspeler', id: nummer, label: `Platenspeler ${nummer}`, nieuw: door })
    await aanvragenGewijzigd()
    if (open.length) await beschikbaarheidGewijzigd()
  }
  return true
}

/** Planner: spelers die te lang niet gebruikt zijn automatisch vrijgeven (vangnet als de kiosk niet reageert). */
export async function geefInactieveSpelersVrij() {
  const inst = await instellingen()
  const min = Number(inst.speler_inactief_min) + Number(inst.speler_reactie_min) + 1
  const oud = await all<{ nummer: number }>(`SELECT nummer FROM platenspelers WHERE sessie IS NOT NULL AND laatst_actief < nu(?::interval)`, `-${min} minutes`)
  for (const p of oud) await geefSpelerVrij(p.nummer, 'inactiviteit', { ...SYSTEEM, naam: 'Automatisch (inactiviteit)' })
  return oud.length
}

/** Kiest per titel een beschikbaar exemplaar (of het gevraagde, als dat beschikbaar is). */
async function kiesExemplaar(titelId: number, voorkeur?: number | null): Promise<number | null> {
  const vrij = await all<{ id: number }>(`SELECT e.id FROM exemplaren e JOIN titels t ON t.id = e.titel_id
    WHERE e.titel_id = ? AND e.status = 'in_collectie' AND t.zichtbaar = 1 AND e.id NOT IN (${OPEN_ITEMS_SQL}) ORDER BY e.id`, titelId)
  if (!vrij.length) return null
  return vrij.find((e) => e.id === voorkeur)?.id ?? vrij[0].id
}

async function volgendBestelnummer(): Promise<number> {
  const r = await get<{ m: number | null }>('SELECT MAX(bestelnummer) AS m FROM aanvragen')
  return Math.max(1000, r?.m ?? 1000) + 1
}

/** Sluit een aanvraag af: exemplaren worden weer beschikbaar. */
export async function sluitAf(id: number, door: string, wie: Wie) {
  const a = await get<any>('SELECT * FROM aanvragen WHERE id = ?', id)
  if (!a || !['ingediend', 'uitgegeven'].includes(a.status)) return false
  await run("UPDATE aanvragen SET status = 'afgesloten', afgesloten_op = nu(), afgesloten_door = ? WHERE id = ?", door, id)
  await log(wie, 'aanvraag afgesloten', { type: 'aanvraag', id, label: `#${a.bestelnummer}`, veld: 'status', oud: a.status, nieuw: `afgesloten (${door})` })
  return true
}

export async function dienAanvraagIn(inv: { platenspeler: number; sessie?: string | null; titels: { titel_id: number; exemplaar_id?: number | null }[]; bezetAfsluiten?: boolean }) {
  const inst = await instellingen()
  const titels = inv.titels ?? []
  if (!titels.length) throw new AanvraagFout('leeg', 'Je aanvraag is leeg.')
  if (titels.length > inst.max_titels) throw new AanvraagFout('te_veel', `Je kunt maximaal ${inst.max_titels} titels tegelijk aanvragen.`)
  if (new Set(titels.map((t) => t.titel_id)).size !== titels.length) throw new AanvraagFout('dubbel', 'Een titel staat dubbel in je aanvraag.')
  const resultaat = await tx(async () => {
    // Eén aanvraag tegelijk reserveren: zo kunnen twee tablets niet hetzelfde exemplaar krijgen.
    await run('SELECT pg_advisory_xact_lock(4711)')
    const speler = await get<any>('SELECT * FROM platenspelers WHERE nummer = ?', inv.platenspeler)
    if (!speler || !speler.actief) throw new AanvraagFout('speler_inactief', 'Deze platenspeler is nu niet beschikbaar.')
    // Alleen wie de speler vasthoudt, kan erop aanvragen.
    if (!inv.sessie || speler.sessie !== inv.sessie) throw new AanvraagFout('speler_kwijt', 'Je platenspeler is vrijgegeven. Kies opnieuw een platenspeler.')
    const open = await openAanvraagVoorSpeler(inv.platenspeler)
    if (open && !inv.bezetAfsluiten) throw new AanvraagFout('bezet', 'Je hebt nog een aanvraag lopen. Wil je die afsluiten? De platen daarvan gaan dan terug.')
    const keuze: { titel_id: number; exemplaar_id: number }[] = []
    const niet: number[] = []
    for (const t of titels) {
      const e = await kiesExemplaar(t.titel_id, t.exemplaar_id)
      if (e == null) niet.push(t.titel_id)
      else keuze.push({ titel_id: t.titel_id, exemplaar_id: e })
    }
    if (niet.length) throw new AanvraagFout('niet_beschikbaar', 'Een of meer titels zijn intussen in gebruik.', { titelIds: niet })
    if (open) await sluitAf(open.id, 'bezoeker', BEZOEKER)
    const nr = await volgendBestelnummer()
    const id = await insert('INSERT INTO aanvragen (bestelnummer, platenspeler) VALUES (?, ?)', nr, inv.platenspeler)
    await run('UPDATE platenspelers SET laatst_actief = nu() WHERE nummer = ?', inv.platenspeler)
    for (const k of keuze) await run('INSERT INTO aanvraag_items (aanvraag_id, titel_id, exemplaar_id) VALUES (?, ?, ?)', id, k.titel_id, k.exemplaar_id)
    return { id, bestelnummer: nr, platenspeler: inv.platenspeler, vorigeAfgesloten: !!open, titelIds: keuze.map((k) => k.titel_id) }
  })
  await aanvragenGewijzigd({ nieuw: resultaat.bestelnummer })
  await beschikbaarheidGewijzigd(resultaat.titelIds)
  if (inst.melding_email_aan && inst.melding_email_adres) {
    // Open punt O-9: optionele e-mailmelding, standaard uit.
    await stuurMail(inst.melding_email_adres, `Nieuwe aanvraag #${resultaat.bestelnummer} voor platenspeler ${resultaat.platenspeler}`,
      `Er is een nieuwe aanvraag (#${resultaat.bestelnummer}) voor platenspeler ${resultaat.platenspeler} met ${resultaat.titelIds.length} titel(s).`).catch(() => {})
  }
  return resultaat
}

// ------------------------------------------------------------------ medewerker

export async function aanvraagDetail(id: number) {
  const a = await get<any>('SELECT * FROM aanvragen WHERE id = ?', id)
  if (!a) return null
  const vc = await vindcoder()
  const items = (await all<any>(`SELECT i.id, i.titel_id, i.exemplaar_id, i.verwijderd, i.reden, t.d_titel AS titel, t.d_artiesten AS artiesten,
      t.d_jaar AS jaar, t.d_drager AS drager, t.d_hoes AS hoes, e.objectnummer, e.vindcode, e.titelnummer
    FROM aanvraag_items i JOIN titels t ON t.id = i.titel_id JOIN exemplaren e ON e.id = i.exemplaar_id WHERE i.aanvraag_id = ?`, id))
    .map((i) => ({ ...i, vindcode: vc(i) }))
  // Gesorteerd op vindcode: zo kan de medewerker in één ronde door het archief (9).
  items.sort((x, y) => (x.verwijderd - y.verwijderd) || String(x.vindcode ?? '~').localeCompare(String(y.vindcode ?? '~'), 'nl', { numeric: true }))
  return { ...a, weergave_status: weergaveStatus(a), items, vindcode_label: VINDCODE_LABEL[(await instellingen()).vindcode_bron] ?? 'Vindcode' }
}

/** Status zoals op het medewerkersscherm: Nieuw, Bezig (wordt opgehaald), Klaar (bij de speler). */
export function weergaveStatus(a: any): string {
  if (a.status === 'ingediend') return a.opgepakt_op ? 'bezig' : 'nieuw'
  if (a.status === 'uitgegeven') return 'klaar'
  return a.status
}

export async function lijstAanvragen(tab: 'actief' | 'afgerond') {
  const rows = await all<any>(tab === 'actief'
    ? `SELECT * FROM aanvragen WHERE status IN ${OPEN} ORDER BY id DESC`
    : `SELECT * FROM aanvragen WHERE status IN ('afgesloten', 'geannuleerd') AND ingediend_op > nu('-2 days') ORDER BY id DESC LIMIT 200`)
  if (!rows.length) return []
  const items = await all<any>(`SELECT i.aanvraag_id, t.d_hoes AS hoes FROM aanvraag_items i JOIN titels t ON t.id = i.titel_id
    WHERE i.verwijderd = 0 AND i.aanvraag_id = ANY(?::int[]) ORDER BY i.id`, `{${rows.map((r) => r.id).join(',')}}`)
  return rows.map((a) => {
    const eigen = items.filter((i) => i.aanvraag_id === a.id)
    return { ...a, weergave_status: weergaveStatus(a), aantal: eigen.length, hoezen: eigen.slice(0, 2).map((i) => i.hoes) }
  })
}

async function wijzigStatus(id: number, van: string[], sql: string, actie: string, wie: Wie, ...p: any[]) {
  const a = await get<any>('SELECT * FROM aanvragen WHERE id = ?', id)
  if (!a) throw new AanvraagFout('niet_gevonden', 'Aanvraag niet gevonden')
  if (!van.includes(a.status)) throw new AanvraagFout('status', 'Deze actie kan niet in de huidige status.')
  await run(sql, ...p, id)
  await log(wie, actie, { type: 'aanvraag', id, label: `#${a.bestelnummer}` })
  await aanvragenGewijzigd()
  await beschikbaarheidGewijzigd()
}

export const ophalen = (id: number, wie: Wie) =>
  wijzigStatus(id, ['ingediend'], 'UPDATE aanvragen SET opgepakt_op = COALESCE(opgepakt_op, nu()) WHERE id = ?', 'aanvraag wordt opgehaald', wie)
export const uitgeven = (id: number, wie: Wie) =>
  wijzigStatus(id, ['ingediend'], "UPDATE aanvragen SET status = 'uitgegeven', uitgegeven_op = nu(), opgepakt_op = COALESCE(opgepakt_op, nu()) WHERE id = ?", 'aanvraag uitgegeven', wie)
export const annuleren = (id: number, reden: string | null, wie: Wie) =>
  wijzigStatus(id, ['ingediend', 'uitgegeven'], "UPDATE aanvragen SET status = 'geannuleerd', geannuleerd_op = nu(), reden = ? WHERE id = ?", 'aanvraag geannuleerd', wie, reden)
/** "Speler vrijgeven" door een medewerker: aanvraag afsluiten en de platenspeler vrijmaken. */
export async function vrijgeven(id: number, wie: Wie) {
  const a = await get<any>('SELECT * FROM aanvragen WHERE id = ?', id)
  if (!a || !['ingediend', 'uitgegeven'].includes(a.status)) throw new AanvraagFout('status', 'Deze aanvraag is al afgesloten.')
  await geefSpelerVrij(a.platenspeler, 'medewerker', wie)
}

/** Eén titel uit de aanvraag halen (bv. niet te vinden). Is het de laatste, dan wordt de aanvraag geannuleerd. */
export async function verwijderItem(aanvraagId: number, itemId: number, reden: string | null, wie: Wie) {
  const a = await get<any>('SELECT * FROM aanvragen WHERE id = ?', aanvraagId)
  if (!a || !['ingediend', 'uitgegeven'].includes(a.status)) throw new AanvraagFout('status', 'Deze aanvraag is niet meer open.')
  const item = await get<any>('SELECT i.*, t.d_titel FROM aanvraag_items i JOIN titels t ON t.id = i.titel_id WHERE i.id = ? AND i.aanvraag_id = ?', itemId, aanvraagId)
  if (!item || item.verwijderd) throw new AanvraagFout('niet_gevonden', 'Titel niet gevonden in deze aanvraag.')
  await run('UPDATE aanvraag_items SET verwijderd = 1, reden = ? WHERE id = ?', reden, itemId)
  await log(wie, 'titel uit aanvraag gehaald', { type: 'aanvraag', id: aanvraagId, label: `#${a.bestelnummer}`, veld: 'titel', oud: item.d_titel, nieuw: reden })
  const over = (await get<{ n: number }>('SELECT COUNT(*) AS n FROM aanvraag_items WHERE aanvraag_id = ? AND verwijderd = 0', aanvraagId))!.n
  if (over === 0) await run("UPDATE aanvragen SET status = 'geannuleerd', geannuleerd_op = nu(), reden = 'Alle titels verwijderd' WHERE id = ?", aanvraagId)
  await aanvragenGewijzigd()
  await beschikbaarheidGewijzigd([item.titel_id])
}

/** Automatische afsluiting bij sluitingstijd (8). */
export async function sluitAllesAf(door: string, wie: Wie): Promise<number> {
  const open = await all<{ id: number }>(`SELECT id FROM aanvragen WHERE status IN ${OPEN}`)
  for (const a of open) await sluitAf(a.id, door, wie)
  // Bij sluitingstijd ook alle platenspelers vrijgeven.
  const vast = await run('UPDATE platenspelers SET sessie = NULL, bezet_sinds = NULL, laatst_actief = NULL WHERE sessie IS NOT NULL')
  if (vast.changes && !open.length) await aanvragenGewijzigd()
  if (open.length) { await aanvragenGewijzigd(); await beschikbaarheidGewijzigd() }
  return open.length
}

/** Lang openstaand: langer dan de ingestelde tijd op "ingediend" (9). */
export function minutenOpen(a: { ingediend_op: string }) {
  return Math.floor((Date.now() - Date.parse(a.ingediend_op.replace(' ', 'T') + 'Z')) / 60000)
}
