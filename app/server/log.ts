// Wijzigingslog (10.12): wie, wanneer, welk record, welk veld, oude en nieuwe waarde.
import { run } from './db.ts'

export type Wie = { id?: number | null; naam: string }
export const SYSTEEM: Wie = { id: null, naam: 'Systeem' }
export const BEZOEKER: Wie = { id: null, naam: 'Bezoeker (kiosk)' }

const s = (v: unknown) => (v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v))

export async function log(wie: Wie, actie: string, r: { type?: string; id?: string | number | null; label?: string | null; veld?: string; oud?: unknown; nieuw?: unknown } = {}) {
  await run(
    `INSERT INTO wijzigingslog (gebruiker_id, gebruiker, actie, record_type, record_id, record_label, veld, oud, nieuw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    wie.id ?? null, wie.naam, actie, r.type ?? null, r.id == null ? null : String(r.id), r.label ?? null, r.veld ?? null, s(r.oud), s(r.nieuw),
  )
}
