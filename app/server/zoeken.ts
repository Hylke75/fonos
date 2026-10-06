// Eigen zoekindex in het geheugen (7.4): titel, artiest, label, tracktitels, componisten en uitvoerenden.
// Ongevoelig voor hoofdletters en accenten, tolereert kleine typfouten, geen externe aanroepen.
import { all } from './db.ts'
import { getoond, ZICHTBAAR_SQL } from './titels.ts'
import { normaliseer } from '../shared/velden.ts'

export type Doc = {
  id: number
  titel: string
  artiesten: string
  artiestLijst: string[]
  personen: Set<string> // genormaliseerde artiesten en componisten, voor de artiestpagina
  jaar: number | null
  drager: string | null
  hoes: string | null
  genres: string[]
  soort: string
  tip: boolean
  uitgelicht: boolean
  toegevoegd: string // eerste exemplaar in de collectie
}

// Gewicht per veld: een treffer in titel of artiest weegt zwaarder dan in een tracktitel.
const GEWICHT = { titel: 10, artiest: 9, componist: 6, uitvoerende: 4, label: 3, track: 2 } as const

let woorden: string[] = [] // gesorteerde woordenlijst
let postings = new Map<string, Map<number, number>>() // woord -> doc -> gewicht
let docs = new Map<number, Doc>()
// Voor typfouten: elk belangrijk woord (titel, artiest, componist) onder zijn varianten met één letter minder.
let weglatingen = new Map<string, string[]>()
let klaar = false
let vuil = true
let timer: NodeJS.Timeout | null = null

/** Na een wijziging in de catalogus: index op de achtergrond opnieuw opbouwen (zoeken gebruikt intussen de oude). */
export function markeerVuil() {
  vuil = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; if (vuil) bouwIndex() }, 1500)
}

const varianten = (w: string) => {
  const out = new Set<string>()
  for (let i = 0; i < w.length; i++) out.add(w.slice(0, i) + w.slice(i + 1))
  return out
}

export function bouwIndex() {
  const t0 = Date.now()
  const p = new Map<string, Map<number, number>>()
  const d = new Map<number, Doc>()
  const belangrijk = new Set<string>()
  const voeg = (tekst: string | undefined | null, id: number, w: number) => {
    if (!tekst) return
    for (const woord of normaliseer(tekst).split(' ')) {
      if (!woord) continue
      let m = p.get(woord)
      if (!m) p.set(woord, (m = new Map()))
      if ((m.get(id) ?? 0) < w) m.set(id, w)
      if (w >= GEWICHT.componist && woord.length >= 3) belangrijk.add(woord)
    }
  }
  const rijen = all<any>(`SELECT t.id, t.mw_data, t.fonos_data, t.d_jaar, t.soort, t.tip, t.uitgelicht,
      (SELECT MIN(e.aangemaakt) FROM exemplaren e WHERE e.titel_id = t.id AND e.status = 'in_collectie') AS toegevoegd
    FROM titels t WHERE ${ZICHTBAAR_SQL}`)
  for (const r of rijen) {
    const v = getoond(r)
    d.set(r.id, {
      id: r.id, titel: v.titel ?? '', artiesten: (v.artiesten ?? []).join(', '), artiestLijst: v.artiesten ?? [],
      personen: new Set([...(v.artiesten ?? []), ...(v.componisten ?? [])].map(normaliseer)),
      jaar: r.d_jaar, drager: v.drager ?? null, hoes: v.hoes_voor ?? null, genres: v.genres ?? [], soort: r.soort,
      tip: !!r.tip, uitgelicht: !!r.uitgelicht, toegevoegd: r.toegevoegd ?? '',
    })
    voeg(v.titel, r.id, GEWICHT.titel)
    for (const a of v.artiesten ?? []) voeg(a, r.id, GEWICHT.artiest)
    for (const c of v.componisten ?? []) voeg(c, r.id, GEWICHT.componist)
    for (const u of v.uitvoerenden ?? []) voeg(u.replace(/\s*\(.*\)$/, ''), r.id, GEWICHT.uitvoerende)
    voeg(v.label, r.id, GEWICHT.label)
    for (const tr of v.tracklist ?? []) {
      voeg(tr.titel, r.id, GEWICHT.track)
      for (const c of tr.componisten ?? []) voeg(c, r.id, GEWICHT.componist)
    }
  }
  const wl = new Map<string, string[]>()
  for (const w of belangrijk) for (const v of varianten(w)) {
    const l = wl.get(v)
    if (l) l.push(w)
    else wl.set(v, [w])
  }
  weglatingen = wl
  postings = p
  docs = d
  woorden = [...p.keys()].sort()
  klaar = true
  vuil = false
  return { titels: d.size, woorden: woorden.length, ms: Date.now() - t0 }
}

function zorgVoorIndex() {
  if (!klaar) bouwIndex()
}

/** Damerau-Levenshtein met afkapgrens; geeft max+1 terug als de afstand groter is. */
function afstand(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev2 = new Array(b.length + 1).fill(0)
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rijMin = i
    for (let j = 1; j <= b.length; j++) {
      const k = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + k)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      if (v < rijMin) rijMin = v
    }
    if (rijMin > max) return max + 1
    prev2.splice(0, prev2.length, ...prev)
    prev = cur
  }
  return prev[b.length]
}

function eersteIndex(prefix: string) {
  let lo = 0, hi = woorden.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (woorden[mid] < prefix) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Treffers voor één zoekwoord: exact, als voorvoegsel (laatste woord) of met kleine typfout. */
function trefWoord(q: string, alsVoorvoegsel: boolean): Map<number, number> {
  const out = new Map<number, number>()
  const neem = (woord: string, factor: number) => {
    for (const [id, w] of postings.get(woord) ?? []) {
      const s = w * factor
      if ((out.get(id) ?? 0) < s) out.set(id, s)
    }
  }
  neem(q, 1)
  if (alsVoorvoegsel || q.length >= 3) {
    let n = 0
    for (let i = eersteIndex(q); i < woorden.length && woorden[i].startsWith(q) && n < 400; i++, n++) {
      if (woorden[i] !== q) neem(woorden[i], alsVoorvoegsel ? 0.8 : 0.5)
    }
  }
  // Typfouten (afstand 1: letter erbij, eraf, anders of verwisseld), alleen als er weinig gevonden is.
  if (q.length >= 3 && out.size < 50) {
    const kandidaten = new Set<string>(weglatingen.get(q) ?? [])
    for (const v of varianten(q)) {
      if (postings.has(v) && v.length >= 3) kandidaten.add(v)
      for (const w of weglatingen.get(v) ?? []) kandidaten.add(w)
    }
    for (const w of kandidaten) if (w !== q && afstand(q, w, 1) <= 1) neem(w, 0.5)
  }
  return out
}

export function zoek(query: string, limiet = 500): { id: number; score: number }[] {
  zorgVoorIndex()
  const q = normaliseer(query)
  if (q.length < 2) return []
  const delen = q.split(' ').filter(Boolean)
  let totaal: Map<number, number> | null = null
  delen.forEach((deel, i) => {
    const t = trefWoord(deel, i === delen.length - 1)
    if (!totaal) { totaal = t; return }
    const n = new Map<number, number>()
    for (const [id, s] of totaal as Map<number, number>) {
      const s2 = t.get(id)
      if (s2) n.set(id, s + s2)
    }
    totaal = n
  })
  const res = [...((totaal as Map<number, number> | null) ?? new Map<number, number>())].map(([id, score]) => ({ id, score }))
  res.sort((a, b) => b.score - a.score || a.id - b.id)
  return res.slice(0, limiet)
}

/** Suggesties terwijl de bezoeker typt: artiesten en titels. */
export function suggesties(query: string, n = 8) {
  const res = zoek(query, 60)
  const q = normaliseer(query)
  const artiesten = new Map<string, number>()
  const titels: { id: number; titel: string; artiesten: string; hoes: string | null }[] = []
  for (const r of res) {
    const d = docs.get(r.id)
    if (!d) continue
    for (const a of d.artiesten.split(', ')) {
      if (a && normaliseer(a).split(' ').some((w) => q.split(' ').some((x) => w.startsWith(x)))) artiesten.set(a, (artiesten.get(a) ?? 0) + 1)
    }
    if (titels.length < n) titels.push({ id: d.id, titel: d.titel, artiesten: d.artiesten, hoes: d.hoes })
  }
  return {
    artiesten: [...artiesten].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([naam]) => naam),
    titels: titels.slice(0, n - Math.min(4, artiesten.size)),
  }
}

export const indexStatus = () => ({ klaar, vuil, titels: docs.size, woorden: woorden.length })
export const docVan = (id: number) => { zorgVoorIndex(); return docs.get(id) }
export const alleDocs = () => { zorgVoorIndex(); return docs }
