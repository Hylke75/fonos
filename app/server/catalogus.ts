// Catalogus voor de bezoekersapp (7.3–7.7). Leest alleen.
import { VINDCODE_LABEL } from '../shared/velden.ts'
import { all, get, instellingen } from './db.ts'
import { zoek } from './zoeken.ts'
import { exemplarenVan, getoond, OPEN_ITEMS_SQL, ZICHTBAAR_SQL, vindcoder } from './titels.ts'
import { normaliseer } from '../shared/velden.ts'
import { platenspelers } from './aanvragen.ts'

/** Beschikbaar: minstens één exemplaar in de collectie dat niet in een open aanvraag zit. */
const BESCHIKBAAR = `EXISTS (SELECT 1 FROM exemplaren e WHERE e.titel_id = t.id AND e.status = 'in_collectie' AND e.id NOT IN (${OPEN_ITEMS_SQL}))`
const KAART = `t.id, t.d_titel AS titel, COALESCE(t.d_artiesten, '') AS artiesten, t.d_jaar AS jaar, t.d_drager AS drager, t.d_hoes AS hoes,
  (${BESCHIKBAAR}) AS beschikbaar`
const GENRES_IN = `t.d_genres::jsonb ?| ARRAY(SELECT jsonb_array_elements_text(?::jsonb))`

export type Kaart = { id: number; titel: string; artiesten: string; jaar: number | null; drager: string | null; hoes: string | null; beschikbaar: boolean }
const kaarten = (rijen: any[]): Kaart[] => rijen.map((r) => ({ ...r, titel: r.titel ?? '', beschikbaar: !!r.beschikbaar }))
const intArray = (ids: number[]) => `{${ids.map((i) => Math.trunc(i)).join(',')}}`

/** Kaarten voor ids, in dezelfde volgorde. */
async function kaartenVoor(ids: number[]): Promise<Kaart[]> {
  if (!ids.length) return []
  return kaarten(await all(`SELECT ${KAART} FROM titels t WHERE t.id = ANY(?::int[]) ORDER BY array_position(?::int[], t.id)`, intArray(ids), intArray(ids)))
}

// ------------------------------------------------------------------ genreknoppen

type Knop = { id: number; naam: string; kleur: string; afbeelding: string | null; nederlands: boolean; genres: string[]; subfilters: { naam: string; genres: string[] }[] }

export async function knoppen(alleenActief = true): Promise<Knop[]> {
  const ks = await all<any>(`SELECT * FROM genreknoppen ${alleenActief ? 'WHERE actief = 1' : ''} ORDER BY volgorde, id`)
  const kop = await all<any>('SELECT * FROM genre_koppelingen ORDER BY id')
  return ks.map((k) => {
    const eigen = kop.filter((g) => g.knop_id === k.id)
    const subs = new Map<string, string[]>()
    for (const g of eigen) if (g.weergavenaam) {
      if (!subs.has(g.weergavenaam)) subs.set(g.weergavenaam, [])
      subs.get(g.weergavenaam)!.push(g.mw_genre)
    }
    return {
      id: k.id, naam: k.naam, kleur: k.kleur, afbeelding: k.afbeelding, nederlands: !!k.nederlands,
      genres: eigen.map((g) => g.mw_genre), subfilters: [...subs].map(([naam, genres]) => ({ naam, genres })),
    }
  })
}

/** Een hoes voor de genretegel: een eigen afbeelding, anders een tip met hoes uit dat genre. */
async function tegelBeeld(k: Knop): Promise<string | null> {
  if (k.afbeelding) return k.afbeelding
  if (!k.genres.length) return null
  const r = await get<{ d_hoes: string }>(`SELECT t.d_hoes FROM titels t WHERE t.d_hoes IS NOT NULL AND ${GENRES_IN} AND ${ZICHTBAAR_SQL}
    ORDER BY t.tip DESC, t.d_jaar DESC NULLS LAST LIMIT 1`, JSON.stringify(k.genres))
  return r?.d_hoes ?? null
}

let configCache: { tijd: number; data: any } | null = null
export const wisConfigCache = () => { configCache = null }

export async function kioskConfig() {
  const inst = await instellingen()
  if (!configCache || Date.now() - configCache.tijd > 120_000) {
    const ks = (await knoppen()).filter((k) => !(k.nederlands && inst.nl_weergave === 'schakelaar'))
    configCache = {
      tijd: Date.now(),
      data: await Promise.all(ks.map(async (k) => ({ id: k.id, naam: k.naam, kleur: k.kleur, beeld: await tegelBeeld(k), nederlands: k.nederlands, subfilters: k.subfilters.map((s) => s.naam) }))),
    }
  }
  return {
    knoppen: configCache.data,
    instellingen: {
      max_titels: inst.max_titels, inactiviteit_sec: inst.inactiviteit_sec, waarschuwing_sec: inst.waarschuwing_sec,
      speler_inactief_min: Number(inst.speler_inactief_min), speler_reactie_min: Number(inst.speler_reactie_min),
      bevestiging_sec: inst.bevestiging_sec, fonos_paginas: inst.fonos_paginas, privacy_tekst: inst.privacy_tekst,
      privacy_url: inst.privacy_url, nl_weergave: inst.nl_weergave, bumper_video_url: inst.bumper_video_url,
      vindcode_label: VINDCODE_LABEL[inst.vindcode_bron] ?? 'Vindcode',
      nieuwsbrief: inst.nieuwsbrief_koppeling !== 'geen', // O-4: zonder koppeling geen aanmelding
      nieuwsbrief_bevestigingsmail: inst.nieuwsbrief_koppeling === 'webhook', // het externe systeem stuurt de bevestiging
    },
    platenspelers: await platenspelers(),
  }
}

// ------------------------------------------------------------------ homepagina en selecties

function vandaagInPeriode(begin: string | null, eind: string | null) {
  if (!begin || !eind) return true
  const nu = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }))
  const md = `${String(nu.getMonth() + 1).padStart(2, '0')}-${String(nu.getDate()).padStart(2, '0')}`
  return begin <= eind ? md >= begin && md <= eind : md >= begin || md <= eind
}

/** Titel-ids van een selectie, in volgorde. alleenBeschikbaar: de rijen op de homepagina (7.3). */
export async function selectieIds(s: any, alleenBeschikbaar: boolean, limiet = s.aantal): Promise<number[]> {
  const inst = await instellingen()
  const filter = `${ZICHTBAAR_SQL}${alleenBeschikbaar ? ` AND ${BESCHIKBAAR}` : ''}`
  if (s.soort === 'uitgelicht') return (await all(`SELECT t.id FROM titels t WHERE t.uitgelicht = 1 AND ${filter} ORDER BY t.id DESC LIMIT ?`, limiet)).map((r) => r.id)
  if (s.soort === 'nieuw') return (await all(`SELECT t.id FROM titels t WHERE ${filter}
      ORDER BY (SELECT MIN(e.aangemaakt) FROM exemplaren e WHERE e.titel_id = t.id AND e.status = 'in_collectie') DESC, t.d_jaar DESC NULLS LAST, t.id DESC LIMIT ?`, limiet)).map((r) => r.id)
  if (s.soort === 'vaak') {
    // De periode staat in Instellingen (10.10); de kolom per selectie is alleen nog een terugval.
    const dagen = Number(inst.vaak_periode_dagen) || s.periode_dagen
    return (await all(`SELECT i.titel_id AS id FROM aanvraag_items i JOIN aanvragen a ON a.id = i.aanvraag_id JOIN titels t ON t.id = i.titel_id
        WHERE a.ingediend_op > nu(?::interval) AND ${filter} GROUP BY i.titel_id ORDER BY COUNT(*) DESC LIMIT ?`, `-${dagen} days`, limiet)).map((r) => r.id)
  }
  const ids = (await all(`SELECT x.titel_id AS id FROM selectie_titels x JOIN titels t ON t.id = x.titel_id WHERE x.selectie_id = ? AND ${filter}
      ORDER BY x.volgorde LIMIT ?`, s.id, limiet)).map((r) => r.id)
  if (s.soort === 'seizoen' && s.mw_genre && ids.length < limiet) {
    const extra = await all(`SELECT t.id FROM titels t WHERE ${GENRES_IN} AND t.d_hoes IS NOT NULL AND ${filter} AND NOT (t.id = ANY(?::int[]))
        ORDER BY t.d_jaar DESC NULLS LAST LIMIT ?`, JSON.stringify([s.mw_genre]), intArray(ids), limiet - ids.length)
    ids.push(...extra.map((r) => r.id))
  }
  return ids
}

let homeCache: { tijd: number; data: any } | null = null
export const wisHomeCache = () => { homeCache = null }

export async function home() {
  if (homeCache && Date.now() - homeCache.tijd < 15_000) return homeCache.data
  const sel = (await all<any>('SELECT * FROM selecties WHERE actief = 1 ORDER BY volgorde, id')).filter((s) => s.soort !== 'seizoen' || vandaagInPeriode(s.begin, s.eind))
  const rijen = (await Promise.all(sel.map(async (s) => ({ id: s.id, naam: s.naam, titels: await kaartenVoor(await selectieIds(s, true)) })))).filter((r) => r.titels.length > 0)
  homeCache = { tijd: Date.now(), data: { rijen } }
  return homeCache.data
}

// ------------------------------------------------------------------ zoeken en bladeren (7.5)

export type Filters = {
  q?: string; knop?: number; sub?: string; drager?: string; decennium?: number; jaar?: number; nl?: boolean; selectie?: number; beschikbaar?: boolean
  sort?: 'relevantie' | 'artiest' | 'album' | 'jaar'; pagina?: number; per?: number
}

type Voorwaarde = { sql: string; p: unknown[] }

export async function zoekCatalogus(f: Filters) {
  const w: Voorwaarde[] = [{ sql: ZICHTBAAR_SQL, p: [] }]
  let volgorde: number[] | null = null
  if (f.q && f.q.trim().length >= 2) {
    volgorde = (await zoek(f.q, 3000)).map((r) => r.id)
    w.push({ sql: 't.id = ANY(?::int[])', p: [intArray(volgorde)] })
  } else if (f.selectie) {
    const s = await get<any>('SELECT * FROM selecties WHERE id = ?', f.selectie)
    volgorde = s ? await selectieIds(s, true, 500) : []
    w.push({ sql: 't.id = ANY(?::int[])', p: [intArray(volgorde)] })
  }
  const ks = await knoppen()
  const knop = f.knop ? ks.find((k) => k.id === f.knop) : undefined
  if (knop) w.push({ sql: GENRES_IN, p: [JSON.stringify(knop.genres)] })
  if (f.nl) {
    const nl = ks.find((k) => k.nederlands) ?? (await knoppen(false)).find((k) => k.nederlands)
    if (nl) w.push({ sql: GENRES_IN, p: [JSON.stringify(nl.genres)] })
  }
  // Alleen wat nu beschikbaar is: minstens één exemplaar in de collectie dat niet in een open aanvraag zit.
  if (f.beschikbaar) w.push({ sql: `EXISTS (SELECT 1 FROM exemplaren e WHERE e.titel_id = t.id AND e.status = 'in_collectie' AND e.id NOT IN (${OPEN_ITEMS_SQL}))`, p: [] })
  const waar = (lijst: Voorwaarde[]) => ({ sql: lijst.map((x) => `(${x.sql})`).join(' AND '), p: lijst.flatMap((x) => x.p) })

  // Subfilters tellen binnen de gekozen knop, vóór het subfilter zelf.
  let subfilters: { naam: string; aantal: number }[] = []
  if (knop) {
    const b = waar(w)
    subfilters = (await all<any>(`SELECT k.weergavenaam AS naam, COUNT(DISTINCT t.id)::int AS aantal FROM titels t
        CROSS JOIN LATERAL jsonb_array_elements_text(t.d_genres::jsonb) g(genre)
        JOIN genre_koppelingen k ON k.mw_genre = g.genre AND k.knop_id = ? AND k.weergavenaam IS NOT NULL
        WHERE ${b.sql} GROUP BY k.weergavenaam`, knop.id, ...b.p))
    const volg = knop.subfilters.map((s) => s.naam)
    subfilters.sort((a, b2) => volg.indexOf(a.naam) - volg.indexOf(b2.naam))
    const s = f.sub ? knop.subfilters.find((x) => x.naam === f.sub) : undefined
    if (s) w.push({ sql: GENRES_IN, p: [JSON.stringify(s.genres)] })
  }
  const b1 = waar(w)
  const dragers = await all<any>(`SELECT t.d_drager AS waarde, COUNT(*)::int AS aantal FROM titels t WHERE ${b1.sql} AND t.d_drager IN ('LP', 'CD') GROUP BY t.d_drager`, ...b1.p)
  if (f.drager) w.push({ sql: 't.d_drager = ?', p: [f.drager] })
  const b2 = waar(w)
  const decennia = await all<any>(`SELECT (t.d_jaar / 10) * 10 AS waarde, COUNT(*)::int AS aantal FROM titels t WHERE ${b2.sql} AND t.d_jaar IS NOT NULL GROUP BY 1 ORDER BY 1`, ...b2.p)
  let jaren: any[] = []
  if (f.decennium) {
    w.push({ sql: 't.d_jaar >= ? AND t.d_jaar < ?', p: [f.decennium, f.decennium + 10] })
    const b3 = waar(w)
    jaren = await all(`SELECT t.d_jaar AS waarde, COUNT(*)::int AS aantal FROM titels t WHERE ${b3.sql} GROUP BY 1 ORDER BY 1`, ...b3.p)
  }
  if (f.jaar) w.push({ sql: 't.d_jaar = ?', p: [f.jaar] })
  const b = waar(w)

  const sort = f.sort ?? (volgorde ? 'relevantie' : 'artiest')
  const orde = sort === 'relevantie' && volgorde
    ? { sql: 'array_position(?::int[], t.id)', p: [intArray(volgorde)] }
    : sort === 'album' ? { sql: 'lower(t.d_titel), t.id', p: [] }
    : sort === 'jaar' ? { sql: 't.d_jaar DESC NULLS LAST, lower(t.d_artiesten), t.id', p: [] }
    : { sql: 't.d_artiesten IS NULL, lower(t.d_artiesten), lower(t.d_titel), t.id', p: [] }
  const per = Math.min(f.per ?? 48, 120)
  const pagina = Math.max(1, f.pagina ?? 1)
  const totaal = (await get<any>(`SELECT COUNT(*)::int AS n FROM titels t WHERE ${b.sql}`, ...b.p))!.n
  const titels = kaarten(await all(`SELECT ${KAART} FROM titels t WHERE ${b.sql} ORDER BY ${orde.sql} LIMIT ? OFFSET ?`, ...b.p, ...orde.p, per, (pagina - 1) * per))
  return {
    totaal, pagina, per, sort, titels,
    facetten: { dragers, decennia, jaren, subfilters },
    knop: knop ? { id: knop.id, naam: knop.naam, kleur: knop.kleur } : null,
  }
}

// ------------------------------------------------------------------ albumpagina (7.6)

export async function album(id: number, voorbeeld = false) {
  const t = await get<any>(`SELECT t.*, (${ZICHTBAAR_SQL}) AS in_app FROM titels t WHERE t.id = ?`, id)
  if (!t) return null
  if (!t.in_app && !voorbeeld) return null // niet zichtbaar in de app
  const v = getoond(t)
  const vc = await vindcoder()
  // "Beschikbare exemplaren": de exemplaren van deze titel en van andere uitgaven (zelfde titel en artiest).
  const uitgaven = await all<any>(`SELECT t.id, t.d_drager, t.d_jaar FROM titels t WHERE t.d_sleutel = ? AND t.id <> ? AND ${ZICHTBAAR_SQL} LIMIT 5`, t.d_sleutel, id)
  const rijen = [{ id, drager: v.drager, jaar: t.d_jaar }, ...uitgaven.map((u) => ({ id: u.id, drager: u.d_drager, jaar: u.d_jaar }))]
  const exemplaren = (await Promise.all(rijen.map(async (r) => (await exemplarenVan(r.id)).filter((e) => e.status === 'in_collectie').map((e) => ({
    exemplaar_id: e.id, titel_id: r.id, drager: r.drager, jaar: r.jaar, vindcode: vc(e), beschikbaar: !e.in_gebruik, deze_titel: r.id === id,
  }))))).flat()
  return {
    id, titelnummer: t.titelnummer, soort: t.soort, velden: v, jaar: t.d_jaar,
    fonos_verhaal: t.fonos_verhaal, ai_tekst: !!t.ai_tekst, tip: !!t.tip,
    // Alleen goedgekeurde koppelingen (automatisch goed of handmatig) tonen; anders niets.
    spotify_album_id: (await instellingen()).spotify_aan && t.spotify_album_id && ['auto_goed', 'handmatig'].includes(t.spotify_status) && /^[A-Za-z0-9]{22}$/.test(t.spotify_album_id) ? t.spotify_album_id : null,
    beschikbaar: exemplaren.some((e) => e.deze_titel && e.beschikbaar),
    exemplaren,
  }
}

// ------------------------------------------------------------------ artiestpagina (7.7)

export async function artiest(naam: string) {
  const n = normaliseer(naam)
  const titels = kaarten(await all(`SELECT ${KAART} FROM titels t WHERE t.d_personen::jsonb @> ?::jsonb AND ${ZICHTBAAR_SQL}
    ORDER BY t.d_jaar DESC NULLS LAST, t.id LIMIT 500`, JSON.stringify([n])))
  // Artiestinformatie alleen als de Muziekweb-dump die bevat (O-2); de huidige dump heeft die niet.
  return { naam, titels }
}

export async function verrasMe(knopId?: number): Promise<number | null> {
  const k = knopId ? (await knoppen()).find((x) => x.id === knopId) : undefined
  const w = k ? `AND ${GENRES_IN}` : ''
  const p = k ? [JSON.stringify(k.genres)] : []
  // Willekeurig maar snel: een willekeurige plek in de id-reeks, dan de eerstvolgende beschikbare titel.
  const r = await get<{ id: number }>(`SELECT t.id FROM titels t WHERE t.d_hoes IS NOT NULL ${w} AND ${ZICHTBAAR_SQL} AND ${BESCHIKBAAR}
      AND t.id >= (SELECT floor(random() * (MAX(id) + 1))::int FROM titels) ORDER BY t.id LIMIT 1`, ...p)
    ?? await get<{ id: number }>(`SELECT t.id FROM titels t WHERE t.d_hoes IS NOT NULL ${w} AND ${ZICHTBAAR_SQL} AND ${BESCHIKBAAR} ORDER BY t.id LIMIT 1`, ...p)
  return r?.id ?? null
}

/** Per titel: beschikbaar, en de vindcode van het exemplaar dat bij aanvragen gereserveerd zou worden. */
export async function beschikbaarheid(ids: number[]) {
  const vc = await vindcoder()
  const zichtbaar = new Set((await all(`SELECT t.id FROM titels t WHERE t.id = ANY(?::int[]) AND ${ZICHTBAAR_SQL}`, intArray(ids))).map((r) => r.id))
  const uit: Record<number, { beschikbaar: boolean; vindcode: string | null }> = {}
  for (const id of ids) {
    const vrij = (await exemplarenVan(id)).find((e) => e.status === 'in_collectie' && !e.in_gebruik)
    uit[id] = { beschikbaar: zichtbaar.has(id) && !!vrij, vindcode: vrij ? vc(vrij) : null }
  }
  return uit
}
