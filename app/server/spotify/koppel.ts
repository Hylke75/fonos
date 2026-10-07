// Koppelen van titels aan Spotify-albums. Hervatbaar: pakt alleen titels met status 'nog_niet' op
// en slaat elk resultaat direct op. Zie scripts/spotify-koppel.ts.
import { all, get, instellingen, run } from '../db.ts'
import { getoond, ZICHTBAAR_SQL } from '../titels.ts'
import { zoekAlbums } from './client.ts'
import { eersteArtiest, normaliseer, scoreKandidaat, statusBij, uitsluitReden, type Kandidaat } from './normaliseer.ts'

export type Uitkomst = { id: number; artiest: string; titel: string; status: 'auto_goed' | 'twijfel' | 'geen' | 'uitgesloten'; reden?: string; kandidaten: Kandidaat[]; zoekopdrachten: number }

/** Genres die bij de knop "Klassiek" horen (uit de genreknoppen). */
export async function klassiekeGenres(): Promise<string[]> {
  return (await all<{ mw_genre: string }>(`SELECT g.mw_genre FROM genre_koppelingen g JOIN genreknoppen k ON k.id = g.knop_id WHERE lower(k.naam) = 'klassiek'`)).map((r) => r.mw_genre)
}

const zonderAanhalingstekens = (s: string) => s.replace(/["']/g, ' ').replace(/\s+/g, ' ').trim()

/** Zoekt en scoort één titel; schrijft niets. */
export async function beoordeel(t: any, generiek: string[], klassiek: string[]): Promise<Uitkomst> {
  const v = getoond(t)
  const artiesten = v.artiesten ?? []
  const titel = v.titel ?? ''
  const artiest = eersteArtiest(artiesten)
  const reden = uitsluitReden({ artiesten, titel, genres: v.genres ?? [], soort: t.soort }, generiek, klassiek)
  if (reden) return { id: t.id, artiest, titel, status: 'uitgesloten', reden, kandidaten: [], zoekopdrachten: 0 }
  // Titel zonder toevoegingen als "[UK]" voor de zoekopdracht.
  const zoekTitel = zonderAanhalingstekens(titel.replace(/\[[^\]]*\]/g, ' '))
  const zoekArtiest = zonderAanhalingstekens(artiest)
  let albums = await zoekAlbums(`album:"${zoekTitel}" artist:"${zoekArtiest}"`)
  let n = 1
  if (!albums.length) { albums = await zoekAlbums(`${zoekArtiest} ${zoekTitel}`); n++ }
  const gezien = new Set<string>()
  const kandidaten = albums.filter((a) => !gezien.has(a.id) && gezien.add(a.id))
    .map((a) => scoreKandidaat(artiest, titel, a))
    .sort((x, y) => y.score - x.score || y.artiest_score - x.artiest_score)
    .slice(0, 3)
  return { id: t.id, artiest, titel, status: statusBij(kandidaten[0]), kandidaten, zoekopdrachten: n }
}

export async function slaOp(u: Uitkomst) {
  const beste = u.kandidaten[0]
  await run(`UPDATE titels SET spotify_status = ?, spotify_album_id = ?, spotify_score = ?, spotify_kandidaat = ?, spotify_gecontroleerd_op = nu() WHERE id = ? AND spotify_status = 'nog_niet'`,
    u.status, u.status === 'auto_goed' ? beste.id : null, beste?.score ?? null,
    JSON.stringify(u.kandidaten.map(({ id, artiest, titel, jaar, cover, score }) => ({ id, artiest, titel, jaar, cover, score }))), u.id)
}

export async function instellingenVoorKoppelen() {
  const inst = await instellingen()
  return { generiek: (inst.spotify_generieke_artiesten ?? []) as string[], klassiek: await klassiekeGenres() }
}

/** Willekeurige zichtbare titels met status 'nog_niet' (voor de proef). */
export async function proefTitels(n: number) {
  return all<any>(`SELECT * FROM titels t WHERE ${ZICHTBAAR_SQL} AND t.spotify_status = 'nog_niet' ORDER BY random() LIMIT ?`, n)
}

/** Volgende reeks voor de volledige koppeling: zichtbare titels met status 'nog_niet'. */
export async function volgendeTitels(n: number) {
  return all<any>(`SELECT * FROM titels t WHERE ${ZICHTBAAR_SQL} AND t.spotify_status = 'nog_niet' ORDER BY t.id LIMIT ?`, n)
}

export async function tellingen() {
  const rijen = await all<{ spotify_status: string; n: number }>(`SELECT t.spotify_status, COUNT(*)::int AS n FROM titels t WHERE ${ZICHTBAAR_SQL} GROUP BY 1`)
  return Object.fromEntries(rijen.map((r) => [r.spotify_status, r.n])) as Record<string, number>
}

export { normaliseer, get }
