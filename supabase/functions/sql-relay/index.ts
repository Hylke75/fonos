// Tijdelijke SQL-doorgeefluik voor bulkladen (app/server/db.ts, FONOS_DB_RELAY) vanaf een machine die Postgres
// niet rechtstreeks kan bereiken. Alleen met een sleutel waarvan de SHA-256 in fonos_relay.sleutel staat en die nog
// geldig is; die tabel zit in een schema dat de API niet blootstelt. Na het laden: functie en schema verwijderen.
import postgres from 'npm:postgres@3.4.5'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, {
  prepare: false,
  max: 3,
  types: {
    bigint: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
    json: { to: 3802, from: [114, 3802], serialize: (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x)), parse: (x: string) => JSON.parse(x) },
  } as any,
  onnotice: () => {},
})

let geldig: { hash: string; tot: number } | null = null
async function magHet(sleutel: string | null) {
  if (!sleutel || sleutel.length < 32) return false
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sleutel))))
    .map((b) => b.toString(16).padStart(2, '0')).join('')
  if (geldig && geldig.hash === hash && geldig.tot > Date.now()) return true
  const r = await sql`SELECT 1 FROM fonos_relay.sleutel WHERE hash = ${hash} AND geldig_tot > now()`
  if (!r.length) return false
  geldig = { hash, tot: Date.now() + 60_000 }
  return true
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' || !(await magHet(req.headers.get('x-relay-sleutel')))) return new Response('Niet toegestaan', { status: 401 })
  const { q, p, exec } = await req.json()
  try {
    // Als de rol van de app (eigenaar van de tabellen), net als de app zelf; per verzoek één transactie.
    const r: any = await sql.begin(async (tx: any) => {
      await tx.unsafe('SET LOCAL ROLE fonos_app')
      return exec ? (await tx.unsafe(q), []) : tx.unsafe(q, p ?? [])
    })
    return Response.json({ rows: [...r], count: r.count ?? r.length })
  } catch (e) {
    return Response.json({ fout: (e as Error).message, code: (e as any).code ?? 'onbekend' }, { status: 500 })
  }
})
