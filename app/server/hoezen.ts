// Kapotte hoezen opsporen (verbetering 14). Elke nacht een deel van de titels; na ongeveer een maand is alles gecontroleerd.
// Muziekweb (media.cdr.nl) geeft voor een ontbrekende hoes geen 404 maar een vervangend GIF-plaatje: dat telt ook als kapot.
import { all, run } from './db.ts'
import { haal, magNaar } from './naarbuiten.ts'

async function controleer(url: string): Promise<boolean | null> {
  const adres = url.replace(/^http:\/\/media\.cdr\.nl\//, 'https://media.cdr.nl/')
  // Alleen Muziekweb en onze eigen opslag; een ander adres (door een redacteur ingevuld) halen we niet op (securityreview R14).
  if (!magNaar('hoezen', adres)) return null
  try {
    const r = await haal('hoezen', adres, { method: 'HEAD', timeoutMs: 8000 })
    if (r.status === 404 || r.status === 410) return false
    if (!r.ok) return r.status === 403 ? false : null // 403 = bestaat niet (meer); andere fouten: later opnieuw
    const type = r.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) return false
    if (/media\.cdr\.nl/.test(url) && type === 'image/gif') return false
    return true
  } catch { return null }
}

/** Controleert de n titels die het langst niet gecontroleerd zijn. Geeft het aantal kapotte terug. */
export async function controleerHoezen(n = 1500, tegelijk = 16) {
  // Eerst de eigen collectie (die niet in de laatste 30 dagen gecontroleerd is), daarna de Muziekweb-naslag.
  const rijen = await all<{ id: number; d_hoes: string }>(`SELECT id, d_hoes FROM titels WHERE d_hoes LIKE 'http%'
    ORDER BY (collectie = 'fonos' AND (hoes_gecontroleerd_op IS NULL OR hoes_gecontroleerd_op < nu('-30 days'))) DESC, hoes_gecontroleerd_op NULLS FIRST, id LIMIT ?`, n)
  let kapot = 0, i = 0
  await Promise.all(Array.from({ length: tegelijk }, async () => {
    while (i < rijen.length) {
      const r = rijen[i++]
      const ok = await controleer(r.d_hoes)
      if (ok === null) continue
      if (!ok) kapot++
      await run('UPDATE titels SET hoes_kapot = ?, hoes_gecontroleerd_op = nu() WHERE id = ?', ok ? 0 : 1, r.id)
    }
  }))
  return { gecontroleerd: rijen.length, kapot }
}
