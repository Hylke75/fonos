// Statistieken over een periode (verbetering 12): voor het programma van Fonos en de verantwoording.
// Periode in Amsterdamse dagen (kolom aanvragen.dag); geannuleerde aanvragen tellen niet mee als gebruik.
import { all, get } from './db.ts'

const DAG = /^\d{4}-\d{2}-\d{2}$/

export function periode(van?: string, tot?: string) {
  const vandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' })
  const t = tot && DAG.test(tot) ? tot : vandaag
  const v = van && DAG.test(van) ? van : new Date(Date.now() - 89 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' })
  return v <= t ? { van: v, tot: t } : { van: t, tot: v }
}

const AMS = (kolom: string) => `((${kolom} || '+00')::timestamptz AT TIME ZONE 'Europe/Amsterdam')`

export async function statistieken(van: string, tot: string) {
  const w = `a.dag >= ? AND a.dag <= ? AND a.status <> 'geannuleerd'`
  const p = [van, tot]
  const kern = await get<any>(`SELECT COUNT(*)::int AS aanvragen, COUNT(DISTINCT a.dag)::int AS dagen,
      ROUND(AVG(EXTRACT(EPOCH FROM ((a.uitgegeven_op || '+00')::timestamptz - (a.ingediend_op || '+00')::timestamptz)) / 60) FILTER (WHERE a.uitgegeven_op IS NOT NULL))::int AS min_tot_uitgifte
    FROM aanvragen a WHERE ${w}`, ...p)
  const items = await get<any>(`SELECT COUNT(*) FILTER (WHERE i.verwijderd = 0)::int AS platen, COUNT(DISTINCT i.titel_id) FILTER (WHERE i.verwijderd = 0)::int AS unieke_titels,
      COUNT(*) FILTER (WHERE i.verwijderd = 1)::int AS niet_gevonden
    FROM aanvraag_items i JOIN aanvragen a ON a.id = i.aanvraag_id WHERE ${w}`, ...p)
  const titels = await all<any>(`SELECT t.id, t.titelnummer, t.d_titel AS titel, t.d_artiesten AS artiesten, t.d_hoes AS hoes, COUNT(*)::int AS aantal
    FROM aanvraag_items i JOIN aanvragen a ON a.id = i.aanvraag_id JOIN titels t ON t.id = i.titel_id
    WHERE ${w} AND i.verwijderd = 0 GROUP BY t.id ORDER BY aantal DESC, t.d_titel LIMIT 25`, ...p)
  const artiesten = await all<any>(`SELECT x.naam, COUNT(*)::int AS aantal FROM aanvraag_items i JOIN aanvragen a ON a.id = i.aanvraag_id JOIN titels t ON t.id = i.titel_id
    CROSS JOIN LATERAL unnest(string_to_array(NULLIF(t.d_artiesten, ''), ', ')) x(naam)
    WHERE ${w} AND i.verwijderd = 0 GROUP BY x.naam ORDER BY aantal DESC, x.naam LIMIT 15`, ...p)
  const stijlen = await all<any>(`SELECT g.genre AS naam, COUNT(*)::int AS aantal FROM aanvraag_items i JOIN aanvragen a ON a.id = i.aanvraag_id JOIN titels t ON t.id = i.titel_id
    CROSS JOIN LATERAL jsonb_array_elements_text(t.d_genres::jsonb) g(genre)
    WHERE ${w} AND i.verwijderd = 0 GROUP BY g.genre ORDER BY aantal DESC, g.genre LIMIT 15`, ...p)
  // Drukte: aanvragen per weekdag (1 = maandag) en uur, in Amsterdamse tijd.
  const drukte = await all<any>(`SELECT EXTRACT(ISODOW FROM ${AMS('a.ingediend_op')})::int AS dag, EXTRACT(HOUR FROM ${AMS('a.ingediend_op')})::int AS uur, COUNT(*)::int AS aantal
    FROM aanvragen a WHERE ${w} GROUP BY 1, 2`, ...p)
  const perDag = await all<any>(`SELECT a.dag, COUNT(*)::int AS aantal FROM aanvragen a WHERE ${w} GROUP BY a.dag ORDER BY a.dag`, ...p)
  const spelers = await all<any>(`SELECT a.platenspeler AS nummer, COUNT(*)::int AS aantal FROM aanvragen a WHERE ${w} GROUP BY 1 ORDER BY 1`, ...p)
  return { van, tot, kern: { ...kern, ...items }, titels, artiesten, stijlen, drukte, per_dag: perDag, spelers }
}

/** CSV met alle aangevraagde titels in de periode, voor verantwoording en programmering. */
export async function statistiekenCsv(van: string, tot: string) {
  const rijen = await all<any>(`SELECT t.titelnummer, t.d_titel AS titel, t.d_artiesten AS artiesten, t.d_jaar AS jaar, t.d_drager AS drager, t.d_genres AS genres, COUNT(*)::int AS aantal
    FROM aanvraag_items i JOIN aanvragen a ON a.id = i.aanvraag_id JOIN titels t ON t.id = i.titel_id
    WHERE a.dag >= ? AND a.dag <= ? AND a.status <> 'geannuleerd' AND i.verwijderd = 0 GROUP BY t.id ORDER BY aantal DESC, t.d_titel`, van, tot)
  const cel = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return ['﻿titelnummer;titel;artiesten;jaar;drager;genres;aantal keer aangevraagd',
    ...rijen.map((r) => [r.titelnummer, r.titel, r.artiesten, r.jaar, r.drager, (JSON.parse(r.genres || '[]') as string[]).join(', '), r.aantal].map(cel).join(';'))].join('\n')
}
