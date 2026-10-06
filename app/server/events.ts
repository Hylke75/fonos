// Realtime verversen. Op Vercel bestaan geen langlopende verbindingen; de schermen vragen daarom elke paar
// seconden de tellers op (GET /api/versies) en verversen als een teller veranderd is.
import { all, run } from './db.ts'

async function verhoog(naam: string, extra?: unknown) {
  await run('UPDATE versies SET waarde = waarde + 1, extra = COALESCE(?, extra) WHERE naam = ?', extra == null ? null : JSON.stringify(extra), naam)
}

/** Beschikbaarheid veranderd: kiosk en medewerkers verversen. */
export const beschikbaarheidGewijzigd = (_titelIds: number[] = []) => verhoog('beschikbaarheid')
/** Aanvragen veranderd; bij een nieuwe aanvraag gaat het bestelnummer mee (geluidssignaal). */
export const aanvragenGewijzigd = (extra: { nieuw?: number } = {}) => verhoog('aanvragen', extra.nieuw ? extra : null)
/** Catalogus veranderd (titels, genreknoppen, selecties). */
export const catalogusVersieOmhoog = () => verhoog('catalogus')

export async function versies() {
  const rows = await all<{ naam: string; waarde: number; extra: string | null }>('SELECT naam, waarde, extra FROM versies')
  const out: Record<string, any> = {}
  for (const r of rows) out[r.naam] = r.waarde
  const a = rows.find((r) => r.naam === 'aanvragen')
  out.laatste_nieuw = a?.extra ? JSON.parse(a.extra).nieuw : null
  return out
}
