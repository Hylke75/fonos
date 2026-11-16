// Wachtlijst voor platenspelers (verbetering 8). Zijn alle spelers bezet, dan zet een bezoeker zich op de lijst.
// Komt er een speler vrij, dan wordt die een paar minuten voor de eerste wachtende vastgehouden; kiest die niet
// op tijd, dan gaat hij naar de volgende. Een tablet die de lijst niet meer opvraagt (weggelopen), valt af.
import { randomUUID } from 'node:crypto'
import { all, get, instellingen, run, tx } from './db.ts'
import { aanvragenGewijzigd } from './events.ts'

const OPEN = "('ingediend', 'uitgegeven')"
const WEG_NA_MIN = 2 // niet meer gezien: van de lijst af

export async function meldAan(tablet?: string | null) {
  const token = randomUUID()
  await run('INSERT INTO wachtlijst (token, tablet) VALUES (?, ?)', token, tablet?.slice(0, 60) ?? null)
  await verdeel()
  return { token, ...(await wachtStatus(token)) }
}

export async function meldAf(token: string) {
  await tx(async () => {
    await run('SELECT pg_advisory_xact_lock(4711)')
    await run("UPDATE wachtlijst SET status = 'afgemeld' WHERE token = ? AND status IN ('wacht', 'opgeroepen')", token)
    await run('UPDATE platenspelers SET gereserveerd_voor = NULL, gereserveerd_tot = NULL WHERE gereserveerd_voor = ?', token)
  })
  await verdeel()
}

/** Positie (1 = eerste) en, als het zover is, de speler die voor deze bezoeker klaarstaat. */
export async function wachtStatus(token: string) {
  await run("UPDATE wachtlijst SET laatst_gezien = nu() WHERE token = ? AND status IN ('wacht', 'opgeroepen')", token)
  await verdeel()
  const w = await get<any>('SELECT * FROM wachtlijst WHERE token = ?', token)
  if (!w) return { status: 'onbekend' as const }
  if (w.status === 'opgeroepen') {
    const sec = (await get<{ s: number }>("SELECT GREATEST(0, EXTRACT(EPOCH FROM (opgeroepen_tot::timestamp - (now() AT TIME ZONE 'UTC'))))::int AS s FROM wachtlijst WHERE id = ?", w.id))!.s
    return { status: 'opgeroepen' as const, speler: w.speler as number, seconden: sec }
  }
  if (w.status !== 'wacht') return { status: w.status as 'geholpen' | 'verlopen' | 'afgemeld' }
  const positie = (await get<{ n: number }>("SELECT COUNT(*)::int AS n FROM wachtlijst WHERE status = 'wacht' AND id <= ?", w.id))!.n
  return { status: 'wacht' as const, positie }
}

/** Mag deze sessie (met of zonder wachtlijst-token) deze speler kiezen? Geeft het token terug als het een reservering inlost. */
export async function reserveringVoor(nummer: number, token?: string | null): Promise<'vrij' | 'eigen' | 'anders'> {
  const p = await get<any>("SELECT gereserveerd_voor, gereserveerd_tot > nu() AS geldig FROM platenspelers WHERE nummer = ?", nummer)
  if (!p?.gereserveerd_voor || !p.geldig) return 'vrij'
  return token && p.gereserveerd_voor === token ? 'eigen' : 'anders'
}

/** Na het kiezen: reservering en wachtlijstplek opruimen (binnen de transactie van kiesSpeler). */
export async function losReserveringIn(nummer: number, token?: string | null) {
  await run('UPDATE platenspelers SET gereserveerd_voor = NULL, gereserveerd_tot = NULL WHERE nummer = ?', nummer)
  if (token) await run("UPDATE wachtlijst SET status = 'geholpen' WHERE token = ?", token)
}

/** Verlopen reserveringen opruimen en vrije spelers toewijzen aan wie het langst wacht. */
export async function verdeel() {
  const inst = await instellingen()
  const minuten = Math.max(1, Number(inst.wachtlijst_reserveer_min) || 3)
  let veranderd = false
  await tx(async () => {
    await run('SELECT pg_advisory_xact_lock(4711)')
    const verlopen = await run("UPDATE wachtlijst SET status = 'verlopen' WHERE status = 'opgeroepen' AND opgeroepen_tot < nu()")
    await run('UPDATE platenspelers SET gereserveerd_voor = NULL, gereserveerd_tot = NULL WHERE gereserveerd_voor IS NOT NULL AND (gereserveerd_tot < nu() OR gereserveerd_voor NOT IN (SELECT token FROM wachtlijst WHERE status = \'opgeroepen\'))')
    await run("UPDATE wachtlijst SET status = 'afgemeld' WHERE status = 'wacht' AND laatst_gezien < nu(?::interval)", `-${WEG_NA_MIN} minutes`)
    const vrij = await all<{ nummer: number }>(`SELECT p.nummer FROM platenspelers p WHERE p.actief = 1 AND p.sessie IS NULL AND p.gereserveerd_voor IS NULL
      AND NOT EXISTS (SELECT 1 FROM aanvragen a WHERE a.platenspeler = p.nummer AND a.status IN ${OPEN}) ORDER BY p.nummer`)
    for (const p of vrij) {
      const w = await get<{ id: number; token: string }>("SELECT id, token FROM wachtlijst WHERE status = 'wacht' ORDER BY id LIMIT 1")
      if (!w) break
      await run("UPDATE wachtlijst SET status = 'opgeroepen', speler = ?, opgeroepen_tot = nu(?::interval) WHERE id = ?", p.nummer, `${minuten} minutes`, w.id)
      await run('UPDATE platenspelers SET gereserveerd_voor = ?, gereserveerd_tot = nu(?::interval) WHERE nummer = ?', w.token, `${minuten} minutes`, p.nummer)
      veranderd = true
    }
    if (verlopen.changes) veranderd = true
    // Oude regels niet eindeloos bewaren.
    await run("DELETE FROM wachtlijst WHERE status NOT IN ('wacht', 'opgeroepen') AND aangemeld < nu('-1 day')")
  })
  if (veranderd) await aanvragenGewijzigd()
}

/** Voor het medewerkersscherm en de status: hoeveel bezoekers wachten er. */
export async function aantalWachtenden() {
  return (await get<{ n: number }>("SELECT COUNT(*)::int AS n FROM wachtlijst WHERE status IN ('wacht', 'opgeroepen')"))!.n
}
