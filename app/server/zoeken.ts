// Zoeken (7.4) in Postgres: full-text op titel, artiest, componist, uitvoerenden, label en tracktitels,
// met gewichten. Ongevoelig voor hoofdletters en accenten (alles genormaliseerd opgeslagen); bij weinig
// treffers worden kleine typfouten opgevangen met trigram-gelijkenis op de woordenlijst.
import { all, tx, run } from './db.ts'
import { ZICHTBAAR_SQL } from './titels.ts'
import { normaliseer } from '../shared/velden.ts'

const RANG = "ts_rank('{0.05, 0.2, 0.5, 1.0}', t.zoek, q)"

async function vindTitels(tsquery: string, limiet: number) {
  return all<{ id: number; score: number }>(
    `SELECT t.id, ${RANG} AS score FROM titels t, to_tsquery('simple', ?) q
      WHERE t.zoek @@ q AND ${ZICHTBAAR_SQL} ORDER BY score DESC, t.id LIMIT ?`, tsquery, limiet)
}

/** Woorden die op een zoekwoord lijken (kleine typfout): trigram-gelijkenis of Levenshtein-afstand. */
async function lijktOp(woord: string): Promise<string[]> {
  return tx(async () => {
    await run(`SET LOCAL pg_trgm.similarity_threshold = ${woord.length <= 4 ? 0.2 : 0.3}`)
    const max = woord.length >= 4 ? 2 : 1
    const r = await all<{ woord: string }>(
      `SELECT woord FROM (
         SELECT woord FROM zoekwoorden WHERE woord % ?
         UNION
         SELECT woord FROM zoekwoorden WHERE left(woord, 1) = left(?, 1) AND abs(length(woord) - ?) <= 1
           AND levenshtein_less_equal(woord, ?, ?) <= ?
       ) x WHERE woord <> ? AND abs(length(woord) - ?) <= 2
       ORDER BY levenshtein(woord, ?), similarity(woord, ?) DESC LIMIT 4`,
      woord, woord, woord.length, woord, max, max, woord, woord.length, woord, woord)
    return r.map((x) => x.woord)
  })
}

export async function zoek(query: string, limiet = 500): Promise<{ id: number; score: number }[]> {
  const delen = normaliseer(query).split(' ').filter(Boolean)
  if (!delen.length || normaliseer(query).length < 2) return []
  const exact = delen.map((d) => `${d}:*`).join(' & ')
  const res = await vindTitels(exact, limiet)
  if (res.length >= 10) return res
  // Weinig gevonden: per woord ook gelijkende woorden toestaan.
  const alternatieven = await Promise.all(delen.map(async (d) => (d.length >= 3 ? [d + ':*', ...(await lijktOp(d))] : [d + ':*'])))
  if (alternatieven.every((a) => a.length === 1)) return res
  const ruim = await vindTitels(alternatieven.map((a) => `(${a.join(' | ')})`).join(' & '), limiet)
  const gezien = new Set(res.map((r) => r.id))
  return [...res, ...ruim.filter((r) => !gezien.has(r.id)).map((r) => ({ ...r, score: r.score * 0.5 }))]
}

/** Suggesties terwijl de bezoeker typt: artiesten en titels. */
export async function suggesties(query: string, n = 8) {
  const res = await zoek(query, 40)
  if (!res.length) return { artiesten: [], titels: [] }
  const rijen = await all<any>('SELECT id, d_titel, d_artiesten, d_hoes FROM titels WHERE id = ANY(?::int[])', `{${res.map((r) => r.id).join(',')}}`)
  const perId = new Map(rijen.map((r) => [r.id, r]))
  const q = normaliseer(query).split(' ')
  const artiesten = new Map<string, number>()
  const titels: { id: number; titel: string; artiesten: string; hoes: string | null }[] = []
  for (const r of res) {
    const d = perId.get(r.id)
    if (!d) continue
    for (const a of (d.d_artiesten ?? '').split(', ')) {
      if (a && normaliseer(a).split(' ').some((w) => q.some((x) => w.startsWith(x)))) artiesten.set(a, (artiesten.get(a) ?? 0) + 1)
    }
    if (titels.length < n) titels.push({ id: d.id, titel: d.d_titel ?? '', artiesten: d.d_artiesten ?? '', hoes: d.d_hoes })
  }
  return {
    artiesten: [...artiesten].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([naam]) => naam),
    titels: titels.slice(0, n - Math.min(4, artiesten.size)),
  }
}
