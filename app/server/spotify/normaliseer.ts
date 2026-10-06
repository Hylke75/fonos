// Normaliseren en vergelijken van artiest en titel voor de koppeling met Spotify.
// Losse, pure functies: getest in tests/spotify.test.ts.

const LIDWOORDEN = new Set(['the', 'de', 'het'])
const ROMEINS: Record<string, string> = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10',
  xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16', xvii: '17', xviii: '18', xix: '19', xx: '20',
}
// Toevoegingen bij Spotify-titels die niets zeggen over welk album het is.
const SPOTIFY_EXTRA = /(remaster|deluxe|expanded|edition|anniversary|bonus|mono|stereo|version|reissue|special|collector)/i

/** Kleine letters, zonder accenten en leestekens, zonder lidwoorden; "&" wordt "and"; romeinse cijfers worden cijfers. */
export function normaliseer(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ') // [UK], [US I]
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !LIDWOORDEN.has(w))
    .map((w) => ROMEINS[w] ?? w)
    .join(' ')
}

/** Eerste artiest; rollen als "(Componist)" weg. */
export function eersteArtiest(artiesten: string[] | string | null | undefined): string {
  const lijst = Array.isArray(artiesten) ? artiesten : (artiesten ?? '').split(/,\s*/)
  return (lijst.find((a) => a && a.trim()) ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim()
}

/** Spotify-titel zonder toevoegingen als (Remastered 2011), (Deluxe Edition), " - Expanded Version". */
export function schoonSpotifyTitel(titel: string): string {
  let t = titel
  t = t.replace(/\s*[([][^)\]]*[)\]]/g, (m) => (SPOTIFY_EXTRA.test(m) ? '' : m))
  t = t.replace(/\s+-\s+[^-]*$/, (m) => (SPOTIFY_EXTRA.test(m) ? '' : m))
  return t.trim()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let vorige = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const rij = [i]
    for (let j = 1; j <= b.length; j++) rij[j] = Math.min(vorige[j] + 1, rij[j - 1] + 1, vorige[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    vorige = rij
  }
  return vorige[b.length]
}

/** Gelijkenis 0–1 van twee al genormaliseerde teksten: het beste van tekenvergelijking en woordvolgorde-onafhankelijke vergelijking. */
export function gelijkenis(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const ratio = (x: string, y: string) => 1 - levenshtein(x, y) / Math.max(x.length, y.length)
  const gesorteerd = (x: string) => x.split(' ').sort().join(' ')
  return Math.max(ratio(a, b), ratio(gesorteerd(a), gesorteerd(b)))
}

export type Kandidaat = { id: string; artiest: string; titel: string; jaar: number | null; cover: string | null; score: number; artiest_score: number; titel_score: number }

export const DREMPEL_GOED = 0.85
export const DREMPEL_TWIJFEL = 0.6
export const DREMPEL_ARTIEST = 0.9

/** Score van een Spotify-album voor een titel: min(artiest, titel). De artiest is de best passende van de albumartiesten. */
export function scoreKandidaat(artiest: string, titel: string, album: { id: string; name: string; artists: { name: string }[]; release_date?: string; images?: { url: string; width?: number | null }[] }): Kandidaat {
  const a = normaliseer(artiest)
  const t = normaliseer(titel)
  const artiest_score = Math.max(0, ...album.artists.map((x) => gelijkenis(a, normaliseer(x.name))))
  const titel_score = gelijkenis(t, normaliseer(schoonSpotifyTitel(album.name)))
  const beelden = [...(album.images ?? [])].sort((x, y) => (x.width ?? 0) - (y.width ?? 0))
  const cover = (beelden.find((b) => (b.width ?? 0) >= 160) ?? beelden.at(-1))?.url ?? null
  return {
    id: album.id, artiest: album.artists.map((x) => x.name).join(', '), titel: album.name,
    jaar: album.release_date ? Number(album.release_date.slice(0, 4)) || null : null, cover,
    score: Math.round(Math.min(artiest_score, titel_score) * 1000) / 1000, artiest_score: Math.round(artiest_score * 1000) / 1000, titel_score: Math.round(titel_score * 1000) / 1000,
  }
}

/** Status bij de beste kandidaat. "auto_goed" alleen als ook de artiest sterk overeenkomt. */
export function statusBij(k: Kandidaat | undefined): 'auto_goed' | 'twijfel' | 'geen' {
  if (!k) return 'geen'
  if (k.score >= DREMPEL_GOED && k.artiest_score >= DREMPEL_ARTIEST) return 'auto_goed'
  if (k.score >= DREMPEL_TWIJFEL) return 'twijfel'
  return 'geen'
}

/** Haalt een album-ID uit een Spotify-link (open.spotify.com/album/…, ook met /intl-nl/), een URI (spotify:album:…) of een los ID. */
export function albumIdUit(invoer: string): string | null {
  const s = invoer.trim()
  const m = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?album\/|spotify:album:)([A-Za-z0-9]{22})/.exec(s) ?? /^([A-Za-z0-9]{22})$/.exec(s)
  return m ? m[1] : null
}

/** Uitsluiten van automatisch koppelen: geen artiest, generieke "artiest", of klassiek. */
export function uitsluitReden(t: { artiesten: string[]; titel: string; genres: string[]; soort?: string | null }, generiek: string[], klassiekeGenres: string[]): string | null {
  const artiest = eersteArtiest(t.artiesten)
  if (!artiest || /^diverse artiesten$|^various( artists)?$/i.test(artiest)) return 'geen artiest'
  const gen = new Set(generiek.map(normaliseer))
  if (gen.has(normaliseer(artiest))) return 'generieke artiest'
  if (t.soort === 'klassiek') return 'klassiek'
  if (!t.genres.length) return 'klassiek (geen genre)'
  const kg = new Set(klassiekeGenres.map((g) => g.toLowerCase()))
  if (t.genres.some((g) => kg.has(g.toLowerCase()))) return 'klassiek (genre)'
  if ((t.titel.match(/\//g) ?? []).length >= 2) return 'klassiek (werk/orkest/dirigent)'
  return null
}
