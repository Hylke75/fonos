// Catalogus voor de bezoekersapp (7.3–7.7). Leest alleen; werkt op de index in het geheugen.
import { all, get, instellingen } from './db.ts'
import { alleDocs, docVan, zoek, type Doc } from './zoeken.ts'
import { exemplarenVan, getoond, OPEN_ITEMS_SQL, vindcode } from './titels.ts'
import { normaliseer } from '../shared/velden.ts'
import { platenspelers } from './aanvragen.ts'

/** Titels die nu helemaal in gebruik zijn (geen vrij exemplaar meer). */
export function inGebruik(): Set<number> {
  const rows = all<{ titel_id: number }>(`SELECT e.titel_id FROM exemplaren e WHERE e.status = 'in_collectie' AND e.titel_id IN
      (SELECT e2.titel_id FROM exemplaren e2 WHERE e2.id IN (${OPEN_ITEMS_SQL}))
    GROUP BY e.titel_id HAVING SUM(CASE WHEN e.id IN (${OPEN_ITEMS_SQL}) THEN 0 ELSE 1 END) = 0`)
  return new Set(rows.map((r) => r.titel_id))
}

export const kaart = (d: Doc, bezet: Set<number>) => ({
  id: d.id, titel: d.titel, artiesten: d.artiesten, jaar: d.jaar, drager: d.drager, hoes: d.hoes, beschikbaar: !bezet.has(d.id),
})

// ------------------------------------------------------------------ genreknoppen

type Knop = { id: number; naam: string; kleur: string; afbeelding: string | null; nederlands: boolean; genres: Set<string>; subfilters: { naam: string; genres: string[] }[] }

export function knoppen(alleenActief = true): Knop[] {
  const ks = all<any>(`SELECT * FROM genreknoppen ${alleenActief ? 'WHERE actief = 1' : ''} ORDER BY volgorde, id`)
  const kop = all<any>('SELECT * FROM genre_koppelingen ORDER BY id')
  return ks.map((k) => {
    const eigen = kop.filter((g) => g.knop_id === k.id)
    const subs = new Map<string, string[]>()
    for (const g of eigen) if (g.weergavenaam) {
      if (!subs.has(g.weergavenaam)) subs.set(g.weergavenaam, [])
      subs.get(g.weergavenaam)!.push(g.mw_genre)
    }
    return {
      id: k.id, naam: k.naam, kleur: k.kleur, afbeelding: k.afbeelding, nederlands: !!k.nederlands,
      genres: new Set(eigen.map((g) => g.mw_genre)), subfilters: [...subs].map(([naam, genres]) => ({ naam, genres })),
    }
  })
}

const heeftGenre = (d: Doc, genres: Set<string> | string[]) => {
  const s = genres instanceof Set ? genres : new Set(genres)
  return d.genres.some((g) => s.has(g))
}

/** Een hoes voor de genretegel: een eigen afbeelding, anders een tip met hoes uit dat genre. */
function tegelBeeld(k: Knop, docs: Map<number, Doc>): string | null {
  if (k.afbeelding) return k.afbeelding
  let beste: Doc | null = null
  for (const d of docs.values()) {
    if (!d.hoes || !heeftGenre(d, k.genres)) continue
    if (!beste || (d.tip && !beste.tip) || (d.tip === beste.tip && (d.jaar ?? 0) > (beste.jaar ?? 0))) beste = d
  }
  return beste?.hoes ?? null
}

let configCache: { tijd: number; data: any } | null = null
export const wisConfigCache = () => { configCache = null }

export function kioskConfig() {
  const inst = instellingen()
  if (!configCache || Date.now() - configCache.tijd > 60_000) {
    const docs = alleDocs()
    configCache = {
      tijd: Date.now(),
      data: knoppen().filter((k) => !(k.nederlands && inst.nl_weergave === 'schakelaar')).map((k) => ({
        id: k.id, naam: k.naam, kleur: k.kleur, beeld: tegelBeeld(k, docs), nederlands: k.nederlands,
        subfilters: k.subfilters.map((s) => s.naam),
      })),
    }
  }
  return {
    knoppen: configCache.data,
    instellingen: {
      max_titels: inst.max_titels, inactiviteit_sec: inst.inactiviteit_sec, waarschuwing_sec: inst.waarschuwing_sec,
      bevestiging_sec: inst.bevestiging_sec, fonos_paginas: inst.fonos_paginas, privacy_tekst: inst.privacy_tekst,
      privacy_url: inst.privacy_url, nl_weergave: inst.nl_weergave, bumper_video_url: inst.bumper_video_url,
    },
    platenspelers: platenspelers(),
  }
}

// ------------------------------------------------------------------ homepagina

function vandaagInPeriode(begin: string | null, eind: string | null) {
  if (!begin || !eind) return true
  const nu = new Date()
  const md = `${String(nu.getMonth() + 1).padStart(2, '0')}-${String(nu.getDate()).padStart(2, '0')}`
  return begin <= eind ? md >= begin && md <= eind : md >= begin || md <= eind
}

export function selectieTitels(s: any, docs: Map<number, Doc>, bezet: Set<number>, alleenBeschikbaar: boolean): Doc[] {
  const inst = instellingen()
  let lijst: Doc[] = []
  if (s.soort === 'uitgelicht') lijst = [...docs.values()].filter((d) => d.uitgelicht).sort((a, b) => b.id - a.id)
  else if (s.soort === 'nieuw') lijst = [...docs.values()].sort((a, b) => b.toegevoegd.localeCompare(a.toegevoegd) || (b.jaar ?? 0) - (a.jaar ?? 0) || b.id - a.id).slice(0, s.aantal * 3)
  else if (s.soort === 'vaak') {
    const dagen = s.periode_dagen || inst.vaak_periode_dagen
    lijst = all<{ titel_id: number }>(`SELECT i.titel_id, COUNT(*) n FROM aanvraag_items i JOIN aanvragen a ON a.id = i.aanvraag_id
        WHERE a.ingediend_op > datetime('now', ?) GROUP BY i.titel_id ORDER BY n DESC LIMIT ?`, `-${dagen} days`, s.aantal * 3)
      .map((r) => docs.get(r.titel_id)).filter(Boolean) as Doc[]
  } else {
    lijst = all<{ titel_id: number }>('SELECT titel_id FROM selectie_titels WHERE selectie_id = ? ORDER BY volgorde', s.id)
      .map((r) => docs.get(r.titel_id)).filter(Boolean) as Doc[]
    if (s.soort === 'seizoen' && s.mw_genre) {
      const al = new Set(lijst.map((d) => d.id))
      lijst.push(...[...docs.values()].filter((d) => !al.has(d.id) && d.genres.includes(s.mw_genre) && d.hoes).sort((a, b) => (b.jaar ?? 0) - (a.jaar ?? 0)))
    }
  }
  // De rijen tonen alleen titels die beschikbaar zijn (7.3).
  if (alleenBeschikbaar) lijst = lijst.filter((d) => !bezet.has(d.id))
  return lijst.slice(0, s.aantal)
}

export function home() {
  const docs = alleDocs()
  const bezet = inGebruik()
  const rijen = all<any>('SELECT * FROM selecties WHERE actief = 1 ORDER BY volgorde, id')
    .filter((s) => s.soort !== 'seizoen' || vandaagInPeriode(s.begin, s.eind))
    .map((s) => ({ id: s.id, naam: s.naam, titels: selectieTitels(s, docs, bezet, true).map((d) => kaart(d, bezet)) }))
    .filter((r) => r.titels.length > 0)
  return { rijen }
}

// ------------------------------------------------------------------ zoeken en bladeren (7.5)

export type Filters = {
  q?: string; knop?: number; sub?: string; drager?: string; decennium?: number; jaar?: number; nl?: boolean; selectie?: number
  sort?: 'relevantie' | 'artiest' | 'album' | 'jaar'; pagina?: number; per?: number
}

export function zoekCatalogus(f: Filters) {
  const docs = alleDocs()
  const bezet = inGebruik()
  let lijst: Doc[]
  const relevantie = new Map<number, number>()
  if (f.q && f.q.trim().length >= 2) {
    for (const r of zoek(f.q, 3000)) relevantie.set(r.id, r.score)
    lijst = [...relevantie.keys()].map((id) => docs.get(id)!).filter(Boolean)
  } else if (f.selectie) {
    const s = get<any>('SELECT * FROM selecties WHERE id = ?', f.selectie)
    lijst = s ? selectieTitels({ ...s, aantal: 500 }, docs, bezet, true) : []
  } else lijst = [...docs.values()]

  const ks = knoppen()
  const knop = f.knop ? ks.find((k) => k.id === f.knop) : undefined
  if (knop) lijst = lijst.filter((d) => heeftGenre(d, knop.genres))
  const subfilters = knop?.subfilters.map((s) => ({ naam: s.naam, aantal: lijst.filter((d) => heeftGenre(d, s.genres)).length })).filter((s) => s.aantal > 0) ?? []
  if (knop && f.sub) {
    const s = knop.subfilters.find((x) => x.naam === f.sub)
    if (s) lijst = lijst.filter((d) => heeftGenre(d, s.genres))
  }
  if (f.nl) {
    const nl = ks.find((k) => k.nederlands) ?? knoppen(false).find((k) => k.nederlands)
    if (nl) lijst = lijst.filter((d) => heeftGenre(d, nl.genres))
  }
  const dragers = tel(lijst, (d) => d.drager)
  if (f.drager) lijst = lijst.filter((d) => d.drager === f.drager)
  const decennia = tel(lijst, (d) => (d.jaar ? Math.floor(d.jaar / 10) * 10 : null))
  if (f.decennium) lijst = lijst.filter((d) => d.jaar && Math.floor(d.jaar / 10) * 10 === f.decennium)
  const jaren = f.decennium ? tel(lijst, (d) => d.jaar) : []
  if (f.jaar) lijst = lijst.filter((d) => d.jaar === f.jaar)

  const sort = f.sort ?? (relevantie.size ? 'relevantie' : 'artiest')
  const nl = (a: string, b: string) => a.localeCompare(b, 'nl', { sensitivity: 'base' })
  if (sort === 'relevantie') lijst.sort((a, b) => (relevantie.get(b.id) ?? 0) - (relevantie.get(a.id) ?? 0))
  else if (sort === 'artiest') lijst.sort((a, b) => nl(a.artiesten || '~', b.artiesten || '~') || nl(a.titel, b.titel))
  else if (sort === 'album') lijst.sort((a, b) => nl(a.titel, b.titel))
  else if (sort === 'jaar') lijst.sort((a, b) => (b.jaar ?? 0) - (a.jaar ?? 0) || nl(a.artiesten, b.artiesten))

  const per = Math.min(f.per ?? 48, 120)
  const pagina = Math.max(1, f.pagina ?? 1)
  return {
    totaal: lijst.length, pagina, per, sort,
    titels: lijst.slice((pagina - 1) * per, pagina * per).map((d) => kaart(d, bezet)),
    facetten: {
      dragers: dragers.filter((x) => x.waarde === 'LP' || x.waarde === 'CD'),
      decennia: decennia.sort((a, b) => Number(a.waarde) - Number(b.waarde)),
      jaren: jaren.sort((a, b) => Number(a.waarde) - Number(b.waarde)),
      subfilters,
    },
    knop: knop ? { id: knop.id, naam: knop.naam, kleur: knop.kleur } : null,
  }
}

function tel<T>(lijst: Doc[], f: (d: Doc) => T | null) {
  const m = new Map<T, number>()
  for (const d of lijst) { const v = f(d); if (v != null) m.set(v, (m.get(v) ?? 0) + 1) }
  return [...m].map(([waarde, aantal]) => ({ waarde, aantal }))
}

// ------------------------------------------------------------------ albumpagina (7.6)

export function album(id: number, voorbeeld = false) {
  const t = get<any>('SELECT * FROM titels WHERE id = ?', id)
  if (!t) return null
  const d = docVan(id)
  if (!d && !voorbeeld) return null // niet zichtbaar in de app
  const v = getoond(t)
  const bezet = inGebruik()
  // "Beschikbare exemplaren": de exemplaren van deze titel en van andere uitgaven (zelfde titel en artiest).
  const sleutel = normaliseer(v.titel ?? '') + '|' + normaliseer((v.artiesten ?? [])[0] ?? '')
  const uitgaven = [...alleDocs().values()].filter((x) => x.id !== id && normaliseer(x.titel) + '|' + normaliseer(x.artiestLijst[0] ?? '') === sleutel).slice(0, 5)
  const rijen = [{ id, drager: v.drager, jaar: t.d_jaar }, ...uitgaven.map((u) => ({ id: u.id, drager: u.drager, jaar: u.jaar }))]
  const exemplaren = rijen.flatMap((r) => exemplarenVan(r.id).filter((e) => e.status === 'in_collectie').map((e) => ({
    exemplaar_id: e.id, titel_id: r.id, drager: r.drager, jaar: r.jaar, vindcode: vindcode(e), beschikbaar: !e.in_gebruik, deze_titel: r.id === id,
  })))
  return {
    id, titelnummer: t.titelnummer, soort: t.soort, velden: v, jaar: t.d_jaar,
    fonos_verhaal: t.fonos_verhaal, ai_tekst: !!t.ai_tekst, tip: !!t.tip,
    beschikbaar: !bezet.has(id) && exemplaren.some((e) => e.deze_titel && e.beschikbaar),
    exemplaren,
  }
}

// ------------------------------------------------------------------ artiestpagina (7.7)

export function artiest(naam: string) {
  const n = normaliseer(naam)
  const bezet = inGebruik()
  const titels = [...alleDocs().values()].filter((d) => d.personen.has(n))
    .sort((a, b) => (b.jaar ?? 0) - (a.jaar ?? 0))
  // Artiestinformatie alleen als de Muziekweb-dump die bevat (O-2); de huidige dump heeft die niet.
  return { naam, titels: titels.map((d) => kaart(d, bezet)) }
}

export function verrasMe(knopId?: number): number | null {
  const bezet = inGebruik()
  let lijst = [...alleDocs().values()].filter((d) => !bezet.has(d.id) && d.hoes)
  if (knopId) {
    const k = knoppen().find((x) => x.id === knopId)
    if (k) lijst = lijst.filter((d) => heeftGenre(d, k.genres))
  }
  if (!lijst.length) return null
  return lijst[Math.floor(Math.random() * lijst.length)].id
}

/** Per titel: beschikbaar, en de vindcode van het exemplaar dat bij aanvragen gereserveerd zou worden. */
export function beschikbaarheid(ids: number[]) {
  const bezet = inGebruik()
  const docs = alleDocs()
  return Object.fromEntries(ids.map((id) => {
    const vrij = exemplarenVan(id).find((e) => e.status === 'in_collectie' && !e.in_gebruik)
    return [id, { beschikbaar: docs.has(id) && !bezet.has(id), vindcode: vrij ? vindcode(vrij) : null }]
  }))
}
